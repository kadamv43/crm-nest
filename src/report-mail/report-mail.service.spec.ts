import mongoose, { Model, Types } from 'mongoose';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AttendanceSchema } from 'src/attendance/attendance.schema';
import { AttendanceService } from 'src/attendance/attendance.service';
import { LeadActivitySchema } from 'src/contacts/lead-activity.schema';
import { SmartViewService } from 'src/dashboard/smart-view.service';
import { UserLeadSchema } from 'src/user-leads/user-lead.schema';
import { BranchSchema } from 'src/branches/branch.schema';
import { ReportMailLogSchema, ReportMailSettingSchema } from './report-mail.schema';
import { ReportMailService, digestOf } from './report-mail.service';

// Runs against a throwaway MongoDB. Set TEST_MONGO_URI; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

// India time written the way people say it.
const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

describeDb('ReportMailService', () => {
  let conn: mongoose.Connection;
  let m: Record<string, Model<any>>;
  let email: { sendHtml: jest.Mock; isConfigured: jest.Mock };
  let service: ReportMailService;

  const A = new Types.ObjectId(); // active, the one most tests use
  const B = new Types.ObjectId(); // active, second company
  const INACTIVE = new Types.ObjectId();
  const EXPIRED = new Types.ObjectId();
  const adminA = new Types.ObjectId();
  const empA1 = new Types.ObjectId();
  const empA2 = new Types.ObjectId();
  const tlA = new Types.ObjectId();
  const adminB = new Types.ObjectId();

  // 2:00 PM on Monday 10 March, in the middle of attendance day Mar 10
  const NOW = ist('2025-03-10 14:00');

  beforeAll(async () => {
    conn = await mongoose.createConnection(uri).asPromise();
    m = {
      setting: conn.model('ReportMailSetting', ReportMailSettingSchema),
      log: conn.model('ReportMailLog', ReportMailLogSchema),
      branch: conn.model('Branch', BranchSchema),
      user: conn.model('User', new mongoose.Schema({ username: String, role: String, email: String, branch: mongoose.Schema.Types.ObjectId, mobile: String })),
      activity: conn.model('LeadActivity', LeadActivitySchema),
      userLead: conn.model('UserLead', UserLeadSchema),
      attendance: conn.model('Attendance', AttendanceSchema),
    };
    await Promise.all([m.setting.init(), m.log.init(), m.attendance.init(), m.activity.init()]);
  }, 60000);

  afterAll(async () => {
    await conn.dropDatabase();
    await conn.close();
  }, 60000);

  beforeEach(async () => {
    await Promise.all(Object.values(m).map((model) => model.deleteMany({})));
    const future = new Date('2099-01-01');
    await m.branch.collection.insertMany([
      { _id: A, name: 'Company A', status: 'Active', expiry_date: future },
      { _id: B, name: 'Company B', status: 'Active', expiry_date: future },
      { _id: INACTIVE, name: 'Inactive Co', status: 'Inactive', expiry_date: future },
      { _id: EXPIRED, name: 'Expired Co', status: 'Active', expiry_date: new Date('2020-01-01') },
    ] as any);
    await m.user.collection.insertMany([
      { _id: adminA, username: 'adminA', role: 'admin', email: 'Admin.A@Example.com', branch: A },
      { _id: tlA, username: 'tlA', role: 'teamlead', email: 'tl@x.com', branch: A },
      { _id: empA1, username: 'empA1', role: 'employee', branch: A },
      { _id: empA2, username: 'empA2', role: 'employee', branch: A },
      { _id: adminB, username: 'adminB', role: 'admin', email: 'admin.b@example.com', branch: B },
    ] as any);

    email = { sendHtml: jest.fn().mockResolvedValue(undefined), isConfigured: jest.fn().mockReturnValue(true) };
    const attendance = new AttendanceService(m.attendance as any);
    const smartView = new SmartViewService(m.activity as any, m.user as any, attendance);
    service = new ReportMailService(m.setting as any, m.log as any, m.branch as any, m.user as any, smartView, attendance, email as any);
    service.retryDelayMs = 0;
  });

  // a company's saved setting
  const configure = (branch: Types.ObjectId, over: any = {}) =>
    m.setting.collection.insertOne({
      branch, enabled: true, recipients: ['boss@x.com'], from_hour: 9, to_hour: 23,
      only_logged_in: false, skip_if_unchanged: false, ...over,
    });

  // A lead for empA1, handed out at 9:00 and set to a status at 11:00 (attendance day Mar 10)
  async function work(user: Types.ObjectId, status = 'DEAD', branch: Types.ObjectId = A) {
    const _id = new Types.ObjectId();
    const base = { contact: new Types.ObjectId(), branch, user, source: 'LEAD', lead: _id };
    await m.activity.collection.insertMany([
      { ...base, type: 'ASSIGNED', to_status: 'FRESH', created_at: ist('2025-03-10 09:00') },
      { ...base, type: 'STATUS_UPDATE', from_status: 'FRESH', to_status: status, created_at: ist('2025-03-10 11:00') },
    ]);
    await m.userLead.collection.insertOne({ _id, user, branch, mobile: String(Math.random()).slice(2, 12), status, created_at: ist('2025-03-10 09:00') });
  }
  const login = (user: Types.ObjectId, at = '2025-03-10 08:30') =>
    new AttendanceService(m.attendance as any).recordLogin(String(user), String(A), ist(at));

  const sentMail = (call = 0) => email.sendHtml.mock.calls[call][0];
  const logRows = (branch = A) => m.log.find({ branch }).sort({ created_at: 1 }).lean<any[]>();

  // ------------------------------------------------------------ the mail
  describe('the hourly mail', () => {
    it('one message goes to everyone on the list, and says what the smart view says', async () => {
      await configure(A, { recipients: ['boss@x.com', 'owner@x.com', 'ops@x.com'] });
      await work(empA1, 'DEAD');
      await work(empA1, 'RINGING');
      await login(empA1);

      const summary = await service.runHourly(NOW);

      expect(summary).toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0, locked: 0 });
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
      const mail = sentMail();
      expect(mail.to).toEqual(['boss@x.com', 'owner@x.com', 'ops@x.com']);
      expect(mail.subject).toBe('Smart view - Company A - 10 Mar, 2:00 PM');
      expect(mail.html).toContain('empA1');
      expect(mail.html).toContain('8:30 AM'); // first login
      expect(mail.text).toContain('empA1 (first login 8:30 AM): Carried forward 0, Assigned 2, Fresh 0, Total 2, Dialed 2');
      expect(mail.text).toContain('Dead 1');
      expect(mail.text).toContain('Ringing 1');
    });

    it('counts who logged in out of the staff (team leads and employees, not the admin)', async () => {
      await configure(A);
      await login(empA1);
      await login(tlA);
      await login(adminA); // the admin is not counted as staff
      await service.runHourly(NOW);
      expect(sentMail().text).toContain('Logged in today: 2 of 3 staff');
    });

    it('with "only logged in", people who did not log in are left out and quiet ones are shown', async () => {
      await configure(A, { only_logged_in: true });
      await work(empA1);
      await work(empA2); // has data but never logged in
      await login(empA1);
      await login(tlA); // logged in, nothing to show: still listed
      await service.runHourly(NOW);
      const html = sentMail().html;
      expect(html).toContain('empA1');
      expect(html).toContain('tlA');
      expect(html).not.toContain('empA2');
      expect(html).toContain('Showing only people who logged in.');
    });

    it('without it, people with data are listed whether or not they logged in', async () => {
      await configure(A);
      await work(empA2);
      await service.runHourly(NOW);
      expect(sentMail().html).toContain('empA2');
    });

    it('a company with nothing to report still gets a mail saying so', async () => {
      await configure(A);
      await service.runHourly(NOW);
      expect(sentMail().html).toContain('Nobody to show yet.');
    });

    it('each company gets only its own data', async () => {
      await configure(A);
      await configure(B, { recipients: ['b@x.com'] });
      await work(empA1);
      await m.user.collection.insertOne({ _id: new Types.ObjectId(), username: 'empB', role: 'employee', branch: B });
      await service.runHourly(NOW);
      const byTo = (to: string) => email.sendHtml.mock.calls.map((c) => c[0]).find((c) => c.to.includes(to));
      expect(byTo('boss@x.com').html).toContain('empA1');
      expect(byTo('boss@x.com').subject).toContain('Company A');
      expect(byTo('b@x.com').subject).toContain('Company B');
      expect(byTo('b@x.com').html).not.toContain('empA1');
    });
  });

  // ------------------------------------------------------------- who is due
  describe('who is due', () => {
    it('only companies that switched it on', async () => {
      await configure(A, { enabled: false });
      await configure(B);
      const summary = await service.runHourly(NOW);
      expect(summary.considered).toBe(1);
      expect(email.sendHtml.mock.calls[0][0].subject).toContain('Company B');
    });

    it.each([
      ['2025-03-10 08:59', false],
      ['2025-03-10 09:00', true],
      ['2025-03-10 09:00', true],
      ['2025-03-10 14:00', true],
      ['2025-03-10 23:00', true],
      ['2025-03-10 23:59', true],
      ['2025-03-11 00:00', false],
      ['2025-03-11 03:00', false],
    ])('at %s with hours 9 to 23: %p', async (when, expected) => {
      await configure(A);
      const summary = await service.runHourly(ist(when));
      expect(summary.sent).toBe(expected ? 1 : 0);
    });

    it('each company has its own sending hours', async () => {
      await configure(A, { from_hour: 10, to_hour: 12 });
      await configure(B, { from_hour: 9, to_hour: 23, recipients: ['b@x.com'] });
      await service.runHourly(ist('2025-03-10 09:00'));
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
      expect(sentMail().subject).toContain('Company B');
      email.sendHtml.mockClear();
      await service.runHourly(ist('2025-03-10 11:00'));
      expect(email.sendHtml).toHaveBeenCalledTimes(2);
      email.sendHtml.mockClear();
      await service.runHourly(ist('2025-03-10 13:00'));
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
    });

    it('a one-hour window works', async () => {
      await configure(A, { from_hour: 15, to_hour: 15 });
      expect((await service.runHourly(ist('2025-03-10 14:00'))).sent).toBe(0);
      expect((await service.runHourly(ist('2025-03-10 15:00'))).sent).toBe(1);
      expect((await service.runHourly(ist('2025-03-10 16:00'))).sent).toBe(0);
    });

    it('inactive and expired companies, and ones without a company record, get nothing', async () => {
      await configure(INACTIVE);
      await configure(EXPIRED);
      await configure(new Types.ObjectId()); // company no longer exists
      const summary = await service.runHourly(NOW);
      expect(summary.considered).toBe(0);
      expect(email.sendHtml).not.toHaveBeenCalled();
    });

    it('a company with nobody to send to is skipped without an error', async () => {
      await configure(A, { recipients: [] });
      const summary = await service.runHourly(NOW);
      expect(summary).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0, locked: 0 });
    });

    it('nothing happens when no company has it switched on', async () => {
      expect(await service.runHourly(NOW)).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0, locked: 0 });
    });
  });

  // -------------------------------------------------------------- the lock
  describe('never sending the same hour twice', () => {
    beforeEach(() => configure(A));

    it('running the same hour again sends nothing more', async () => {
      await service.runHourly(NOW);
      const again = await service.runHourly(new Date(NOW.getTime() + 5 * 60 * 1000)); // 2:05 PM, same hour
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
      expect(again).toMatchObject({ considered: 1, sent: 0, locked: 1 });
    });

    it('the next hour sends again', async () => {
      await service.runHourly(NOW);
      await service.runHourly(ist('2025-03-10 15:00'));
      expect(email.sendHtml).toHaveBeenCalledTimes(2);
      expect((await logRows()).map((r) => r.slot)).toEqual(['2025-03-10 14', '2025-03-10 15']);
    });

    it('several runs at the same moment (two copies of the server) send one mail', async () => {
      await Promise.all([1, 2, 3, 4, 5].map(() => service.runHourly(NOW)));
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
      expect(await m.log.countDocuments({ branch: A })).toBe(1);
    });

    it('a restart in the middle of the hour does not send again', async () => {
      await service.runHourly(NOW);
      const restarted = new ReportMailService(
        m.setting as any, m.log as any, m.branch as any, m.user as any,
        new SmartViewService(m.activity as any, m.user as any, new AttendanceService(m.attendance as any)),
        new AttendanceService(m.attendance as any), email as any,
      );
      await restarted.runHourly(new Date(NOW.getTime() + 20 * 60 * 1000));
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
    });

    it('the hour is still taken only once even if the unique index is missing', async () => {
      await m.log.collection.dropIndexes();
      await service.runHourly(NOW);
      const again = await service.runHourly(new Date(NOW.getTime() + 60 * 1000));
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
      expect(again.locked).toBe(1);
      expect(await m.log.countDocuments({ branch: A })).toBe(1);
    });

    it('creates its indexes when the application starts, even if they were dropped', async () => {
      await m.log.collection.dropIndexes();
      await m.setting.collection.dropIndexes();
      await service.onModuleInit();
      const logIndexes = (await m.log.collection.indexes()).map((i: any) => i.name);
      const settingIndexes = (await m.setting.collection.indexes()).map((i: any) => i.name);
      expect(logIndexes).toEqual(expect.arrayContaining(['branch_1_slot_1', 'created_at_1']));
      expect(settingIndexes).toContain('branch_1');
      // and now the database itself refuses a second row for one company and hour
      await m.log.collection.insertOne({ branch: A, slot: 'x', status: 'SENT' });
      await expect(m.log.collection.insertOne({ branch: A, slot: 'x', status: 'SENT' })).rejects.toMatchObject({ code: 11000 });
    });

    it('a mail that is being sent right now is left alone', async () => {
      await m.log.collection.insertOne({ branch: A, slot: '2025-03-10 14', status: 'SENDING', created_at: new Date(NOW.getTime() - 60 * 1000), recipients_count: 1 });
      const summary = await service.runHourly(NOW);
      expect(summary.locked).toBe(1);
      expect(email.sendHtml).not.toHaveBeenCalled();
    });

    it('a send that was interrupted long ago (server stopped) is picked up again', async () => {
      await m.log.collection.insertOne({ branch: A, slot: '2025-03-10 14', status: 'SENDING', created_at: new Date(NOW.getTime() - 20 * 60 * 1000), recipients_count: 1 });
      const summary = await service.runHourly(NOW);
      expect(summary.sent).toBe(1);
      expect((await logRows())[0].status).toBe('SENT');
    });
  });

  // ------------------------------------------------------------- failures
  describe('when sending fails', () => {
    beforeEach(() => configure(A));

    it('retries once and succeeds', async () => {
      email.sendHtml.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined);
      const summary = await service.runHourly(NOW);
      expect(email.sendHtml).toHaveBeenCalledTimes(2);
      expect(summary.sent).toBe(1);
      expect((await logRows())[0]).toMatchObject({ status: 'SENT' });
    });

    it('gives up after the retry and records why, for the settings page', async () => {
      email.sendHtml.mockRejectedValue(new Error('535 Authentication failed'));
      const summary = await service.runHourly(NOW);
      expect(email.sendHtml).toHaveBeenCalledTimes(2);
      expect(summary).toMatchObject({ failed: 1, sent: 0 });
      expect((await logRows())[0]).toMatchObject({ status: 'FAILED', error: '535 Authentication failed' });
      const saved = await m.setting.findOne({ branch: A }).lean<any>();
      expect(saved).toMatchObject({ last_status: 'FAILED', last_error: '535 Authentication failed' });
    });

    it('a very long error is cut short', async () => {
      email.sendHtml.mockRejectedValue(new Error('x'.repeat(2000)));
      await service.runHourly(NOW);
      expect((await logRows())[0].error.length).toBe(300);
    });

    it('a failed hour can be tried again later in the same hour, and then it sticks', async () => {
      email.sendHtml.mockRejectedValue(new Error('down'));
      await service.runHourly(NOW);
      email.sendHtml.mockReset().mockResolvedValue(undefined);
      const later = await service.runHourly(new Date(NOW.getTime() + 10 * 60 * 1000));
      expect(later.sent).toBe(1);
      expect((await logRows())[0].status).toBe('SENT');
      email.sendHtml.mockClear();
      await service.runHourly(new Date(NOW.getTime() + 20 * 60 * 1000));
      expect(email.sendHtml).not.toHaveBeenCalled(); // sent now: never again this hour
    });

    it('one company failing does not stop the others', async () => {
      await configure(B, { recipients: ['b@x.com'] });
      email.sendHtml.mockImplementation(async (mail: any) => {
        if (mail.subject.includes('Company A')) throw new Error('rejected');
      });
      const summary = await service.runHourly(NOW);
      expect(summary).toMatchObject({ considered: 2, sent: 1, failed: 1 });
      expect((await logRows(B))[0].status).toBe('SENT');
      expect((await logRows(A))[0].status).toBe('FAILED');
    });

    it('a problem building one company\'s mail is contained too', async () => {
      await configure(B, { recipients: ['b@x.com'] });
      const real = (service as any).build.bind(service);
      jest.spyOn(service as any, 'build').mockImplementation(async (branch: any, ...rest: any[]) => {
        if (String(branch._id) === String(A)) throw new Error('could not build');
        return real(branch, ...rest);
      });
      const summary = await service.runHourly(NOW);
      expect(summary).toMatchObject({ sent: 1, failed: 1 });
      expect((await logRows(A))[0]).toMatchObject({ status: 'FAILED', error: 'could not build' });
    });
  });

  // -------------------------------------------------- skip if unchanged
  describe('skip an hour when nothing changed', () => {
    it('off: every hour is sent, even with the same numbers', async () => {
      await configure(A);
      await work(empA1);
      await service.runHourly(ist('2025-03-10 14:00'));
      await service.runHourly(ist('2025-03-10 15:00'));
      expect(email.sendHtml).toHaveBeenCalledTimes(2);
    });

    it('on: the first hour is sent, an identical hour is skipped, a change is sent', async () => {
      await configure(A, { skip_if_unchanged: true });
      await work(empA1, 'DEAD');

      expect((await service.runHourly(ist('2025-03-10 14:00'))).sent).toBe(1);
      const same = await service.runHourly(ist('2025-03-10 15:00'));
      expect(same).toMatchObject({ sent: 0, skipped: 1 });
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
      expect((await logRows()).map((r) => r.status)).toEqual(['SENT', 'SKIPPED']);

      await work(empA1, 'RINGING'); // a new lead worked: numbers change
      expect((await service.runHourly(ist('2025-03-10 16:00'))).sent).toBe(1);
      expect(email.sendHtml).toHaveBeenCalledTimes(2);

      expect((await service.runHourly(ist('2025-03-10 17:00'))).skipped).toBe(1); // unchanged again
    });

    it('a failed mail does not count as "already sent", so the next hour still sends', async () => {
      await configure(A, { skip_if_unchanged: true });
      email.sendHtml.mockRejectedValue(new Error('down'));
      await service.runHourly(ist('2025-03-10 14:00'));
      email.sendHtml.mockReset().mockResolvedValue(undefined);
      expect((await service.runHourly(ist('2025-03-10 15:00'))).sent).toBe(1);
    });

    it('the fingerprint ignores order and changes with any number', () => {
      const a = { user: 'u1', status: { fresh: 1, total: 2 } };
      const b = { user: 'u2', status: { fresh: 0, total: 5 } };
      expect(digestOf([a, b])).toBe(digestOf([b, a]));
      expect(digestOf([a, b])).not.toBe(digestOf([a, { ...b, status: { fresh: 0, total: 6 } }]));
      expect(digestOf([a])).not.toBe(digestOf([a, b]));
      expect(digestOf([])).toBe(digestOf([]));
    });
  });

  // ------------------------------------------------------------ test mail
  describe('send test email now', () => {
    it('sends the real mail to the saved list, marked [TEST], without using up the hour', async () => {
      await configure(A, { enabled: false, recipients: ['boss@x.com', 'owner@x.com'] });
      await work(empA1);
      const result = await service.sendTest(String(A), NOW);

      expect(result.sent_to).toEqual(['boss@x.com', 'owner@x.com']);
      expect(sentMail().subject).toBe('[TEST] Smart view - Company A - 10 Mar, 2:00 PM');
      expect(sentMail().to).toEqual(['boss@x.com', 'owner@x.com']);
      expect(await m.log.countDocuments({})).toBe(0); // no lock taken
      expect(await m.setting.findOne({ branch: A }).lean<any>()).toMatchObject({ last_status: 'SENT' });
      // and the real hourly mail still goes out
      await m.setting.updateOne({ branch: A }, { $set: { enabled: true } });
      expect((await service.runHourly(NOW)).sent).toBe(1);
    });

    it('says so when this server has no mail set up', async () => {
      email.isConfigured.mockReturnValue(false);
      await configure(A);
      await expect(service.sendTest(String(A), NOW)).rejects.toThrow(/Mail is not set up on this server/);
      expect(email.sendHtml).not.toHaveBeenCalled();
    });

    it('needs saved settings with an address', async () => {
      await expect(service.sendTest(String(A), NOW)).rejects.toThrow(BadRequestException);
      await configure(A, { recipients: [] });
      await expect(service.sendTest(String(A), NOW)).rejects.toThrow(/Save at least one email address first/);
    });

    it('a mail server error is shown to the person who pressed the button, and remembered', async () => {
      await configure(A);
      email.sendHtml.mockRejectedValue(new Error('535 Authentication failed'));
      await expect(service.sendTest(String(A), NOW)).rejects.toThrow(BadGatewayException);
      await expect(service.sendTest(String(A), NOW)).rejects.toThrow(/535 Authentication failed/);
      expect(await m.setting.findOne({ branch: A }).lean<any>()).toMatchObject({ last_status: 'FAILED', last_error: '535 Authentication failed' });
    });
  });

  // -------------------------------------------------------------- settings
  describe('settings', () => {
    it('a company that never saved any gets the defaults with its admin\'s address ready', async () => {
      const s = await service.getSettings(String(A));
      expect(s).toMatchObject({
        saved: false, enabled: false, recipients: ['admin.a@example.com'],
        from_hour: 9, to_hour: 23, only_logged_in: false, skip_if_unchanged: false,
        last_sent_at: null, last_status: null,
      });
    });

    it('no admin address means an empty list, not an error', async () => {
      await m.user.deleteMany({ branch: A, role: 'admin' });
      expect((await service.getSettings(String(A))).recipients).toEqual([]);
    });

    it('saving tidies the addresses: trimmed, lower case, no repeats, no blanks', async () => {
      const s = await service.saveSettings(String(A), {
        enabled: true,
        recipients: [' Boss@X.com ', 'boss@x.com', '', '  ', 'Owner@x.COM'],
      }, String(adminA));
      expect(s.recipients).toEqual(['boss@x.com', 'owner@x.com']);
      expect(s.saved).toBe(true);
      expect(s.enabled).toBe(true);
      expect((await m.setting.findOne({ branch: A }).lean<any>()).updated_by).toEqual(adminA);
    });

    it('changing one thing keeps the rest', async () => {
      await service.saveSettings(String(A), { enabled: true, recipients: ['boss@x.com'], from_hour: 10, to_hour: 20, only_logged_in: true });
      const s = await service.saveSettings(String(A), { skip_if_unchanged: true });
      expect(s).toMatchObject({ enabled: true, recipients: ['boss@x.com'], from_hour: 10, to_hour: 20, only_logged_in: true, skip_if_unchanged: true });
    });

    it('a second save updates the same record', async () => {
      await service.saveSettings(String(A), { enabled: false, recipients: ['a@x.com'] });
      await service.saveSettings(String(A), { enabled: false, recipients: ['b@x.com'] });
      expect(await m.setting.countDocuments({ branch: A })).toBe(1);
      expect((await service.getSettings(String(A))).recipients).toEqual(['b@x.com']);
    });

    it('ten addresses are the most', async () => {
      const ten = Array.from({ length: 10 }, (_, i) => `p${i}@x.com`);
      expect((await service.saveSettings(String(A), { enabled: true, recipients: ten })).recipients).toHaveLength(10);
      await expect(service.saveSettings(String(A), { recipients: [...ten, 'p10@x.com'] })).rejects.toThrow(/At most 10/);
    });

    it.each(['not-an-email', 'a@', '@x.com', 'a b@x.com', 'a@x', 'a@x.c', 'x'.repeat(250) + '@x.com'])(
      'refuses the address %p',
      async (bad) => {
        await expect(service.saveSettings(String(A), { enabled: false, recipients: ['ok@x.com', bad] })).rejects.toThrow(BadRequestException);
        expect(await m.setting.countDocuments({})).toBe(0); // nothing half-saved
      },
    );

    it('recipients must be a list', async () => {
      await expect(service.saveSettings(String(A), { recipients: 'a@x.com' })).rejects.toThrow(/list of email addresses/);
    });

    it.each([[-1], [24], [9.5], ['9'], [null]])('refuses the hour %p', async (hour) => {
      await expect(service.saveSettings(String(A), { enabled: false, recipients: [], from_hour: hour })).rejects.toThrow(/whole hour/);
    });

    it('the first hour cannot be after the last', async () => {
      await expect(service.saveSettings(String(A), { enabled: false, recipients: [], from_hour: 20, to_hour: 10 })).rejects.toThrow(/must not be after/);
      await service.saveSettings(String(A), { enabled: false, recipients: [], from_hour: 0, to_hour: 0 }); // one hour is fine
    });

    it('it cannot be switched on without an address', async () => {
      await expect(service.saveSettings(String(A), { enabled: true, recipients: [] })).rejects.toThrow(/at least one email address/);
    });

    it.each([['yes'], [1], [null]])('the switches must be true or false, not %p', async (value) => {
      await expect(service.saveSettings(String(A), { enabled: value, recipients: ['a@x.com'] })).rejects.toThrow(/true or false/);
      await expect(service.saveSettings(String(A), { only_logged_in: value })).rejects.toThrow(/true or false/);
    });

    it('fields that are not settings cannot be set', async () => {
      await service.saveSettings(String(A), {
        enabled: false, recipients: ['a@x.com'],
        branch: String(B), last_status: 'SENT', last_digest: 'x', created_at: new Date(0),
      } as any);
      const saved = await m.setting.findOne({ branch: A }).lean<any>();
      expect(String(saved.branch)).toBe(String(A));
      expect(saved.last_status ?? null).toBeNull();
      expect(saved.last_digest).toBeUndefined();
    });

    it('settings of two companies stay apart', async () => {
      await service.saveSettings(String(A), { enabled: true, recipients: ['a@x.com'] });
      await service.saveSettings(String(B), { enabled: false, recipients: ['b@x.com'] });
      expect((await service.getSettings(String(A))).recipients).toEqual(['a@x.com']);
      expect((await service.getSettings(String(B))).recipients).toEqual(['b@x.com']);
    });
  });

  describe('history', () => {
    it('lists the most recent mails first, at most 20', async () => {
      await configure(A);
      for (let h = 9; h <= 23; h++) {
        await service.runHourly(ist(`2025-03-10 ${String(h).padStart(2, '0')}:00`));
      }
      await service.runHourly(ist('2025-03-11 09:00'));
      await service.runHourly(ist('2025-03-11 10:00'));
      await service.runHourly(ist('2025-03-11 11:00'));
      await service.runHourly(ist('2025-03-11 12:00'));
      await service.runHourly(ist('2025-03-11 13:00'));
      await service.runHourly(ist('2025-03-11 14:00'));
      await m.log.collection.updateMany({}, [{ $set: { created_at: { $dateFromString: { dateString: { $concat: [{ $substr: ['$slot', 0, 10] }, 'T', { $substr: ['$slot', 11, 2] }, ':00:00+05:30'] } } } } }] as any);
      const logs = await service.recentLogs(String(A));
      expect(logs).toHaveLength(20);
      expect(logs[0].slot).toBe('2025-03-11 14');
      expect(logs[19].slot < logs[0].slot).toBe(true);
    });

    it('only the asked company', async () => {
      await configure(A);
      await configure(B, { recipients: ['b@x.com'] });
      await service.runHourly(NOW);
      expect(await service.recentLogs(String(B))).toHaveLength(1);
      expect(await m.log.countDocuments({})).toBe(2);
    });
  });
});
