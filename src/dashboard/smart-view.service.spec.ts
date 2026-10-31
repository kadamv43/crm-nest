import mongoose, { Model, Types } from 'mongoose';
import { LeadActivitySchema } from 'src/contacts/lead-activity.schema';
import { AttendanceSchema } from 'src/attendance/attendance.schema';
import { AttendanceService } from 'src/attendance/attendance.service';
import { UserLeadSchema } from 'src/user-leads/user-lead.schema';
import { UserLeadsService } from 'src/user-leads/user-leads.service';
import { SmartViewService } from './smart-view.service';

// Runs against a throwaway MongoDB. Set TEST_MONGO_URI; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

// India time written the way people say it.
const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

describeDb('SmartViewService', () => {
  let conn: mongoose.Connection;
  let activity: Model<any>;
  let userLeads: Model<any>;
  let users: Model<any>;
  let attendanceModel: Model<any>;
  let attendance: AttendanceService;
  let service: SmartViewService;

  const branch = new Types.ObjectId();
  const otherBranch = new Types.ObjectId();
  const asha = new Types.ObjectId();
  const ravi = new Types.ObjectId();
  const meena = new Types.ObjectId();
  const outsider = new Types.ObjectId();
  const everyone = [asha, ravi, meena].map(String);

  beforeAll(async () => {
    conn = await mongoose.createConnection(uri).asPromise();
    activity = conn.model('LeadActivity', LeadActivitySchema);
    userLeads = conn.model('UserLead', UserLeadSchema);
    users = conn.model('User', new mongoose.Schema({ username: String, mobile: String }));
    attendanceModel = conn.model('Attendance', AttendanceSchema);
    await Promise.all([activity.init(), attendanceModel.init()]);
    attendance = new AttendanceService(attendanceModel as any);
    service = new SmartViewService(activity as any, users as any, attendance);
  }, 60000);

  afterAll(async () => {
    await conn.dropDatabase();
    await conn.close();
  }, 60000);

  beforeEach(async () => {
    await Promise.all([activity.deleteMany({}), userLeads.deleteMany({}), users.deleteMany({}), attendanceModel.deleteMany({})]);
    await users.insertMany([
      { _id: asha, username: 'asha', mobile: '1' },
      { _id: ravi, username: 'Ravi', mobile: '2' },
      { _id: meena, username: 'meena.k', mobile: '3' },
      { _id: outsider, username: 'outsider', mobile: '4' },
    ]);
  });

  /**
   * A lead handed to a staff member, then worked. Writes the calling row (for
   * the "still exists" check) and the activity the app would have written.
   */
  let counter = 0;
  async function lead(
    user: Types.ObjectId,
    assignedAt: Date,
    steps: [string, string][] = [], // [when, status]
    options: { source?: string; assignedStatus?: string; deleted?: boolean; branch?: Types.ObjectId } = {},
  ) {
    const _id = new Types.ObjectId();
    const first = options.assignedStatus ?? 'FRESH';
    const events: any[] = [
      {
        contact: new Types.ObjectId(), branch: options.branch ?? branch, user, type: 'ASSIGNED',
        source: options.source ?? 'LEAD', lead: _id, to_status: first, created_at: assignedAt,
      },
    ];
    let previous = first;
    for (const [when, status] of steps) {
      events.push({
        contact: events[0].contact, branch: options.branch ?? branch, user, type: 'STATUS_UPDATE',
        source: options.source ?? 'LEAD', lead: _id, from_status: previous, to_status: status, created_at: ist(when),
      });
      previous = status;
    }
    await activity.collection.insertMany(events);
    if (!options.deleted) {
      await userLeads.collection.insertOne({
        _id, user, branch: options.branch ?? branch, mobile: String(9000000000 + counter++), status: previous,
        created_at: assignedAt, updated_at: new Date(),
      });
    }
    return _id;
  }

  const row = (res: any, name: string) => res.result.find((r: any) => r.userDetails.username === name);
  const nums = (r: any) => r.status;

  // ---------------------------------------------------------------------------
  describe('the example: 10 leads in the morning, 6 worked by evening', () => {
    // Day 1 = Monday 10 March (attendance day 8 AM Mon to 8 AM Tue)
    beforeEach(async () => {
      const ids: Types.ObjectId[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(await lead(asha, ist('2025-03-10 08:30')));
      }
      // end of day 1: ringing 1, callback 2, payment done 2, dead 1
      const day1: [number, string, string][] = [
        [0, '2025-03-10 11:00', 'RINGING'],
        [1, '2025-03-10 11:30', 'CALLBACK'],
        [2, '2025-03-10 12:00', 'CALLBACK'],
        [3, '2025-03-10 14:00', 'PAYMENT_DONE'],
        [4, '2025-03-10 15:00', 'PAYMENT_DONE'],
        [5, '2025-03-10 16:00', 'DEAD'],
      ];
      for (const [i, when, status] of day1) {
        await activity.collection.insertOne({
          contact: new Types.ObjectId(), branch, user: asha, type: 'STATUS_UPDATE', source: 'LEAD',
          lead: ids[i], from_status: 'FRESH', to_status: status, created_at: ist(when),
        });
      }
      // The calling rows end in their final state (after day 2 below).
      await userLeads.collection.updateMany({ _id: { $in: ids } }, { $set: { status: 'FRESH' } });
      (global as any).__ids = ids;
    });

    const day = (from: string, to?: string) =>
      service.build({ userIds: everyone, from, to });

    it('day 1 shows exactly the end-of-day numbers', async () => {
      const r = row(await day('2025-03-10'), 'asha');
      expect(nums(r)).toMatchObject({
        assigned: 10, carried_forward: 0, fresh: 4, total: 10, total_dialed: 6,
        ringing: 1, callback: 2, payment_done: 2, dead: 1,
      });
    });

    it('day 2: the 4 untouched leads are carried forward, new leads are assigned, and day 1 never changes', async () => {
      const ids: Types.ObjectId[] = (global as any).__ids;
      // day 2: 5 new leads; work 3 of the carried ones; re-call the ringing one
      const fresh5: Types.ObjectId[] = [];
      for (let i = 0; i < 5; i++) fresh5.push(await lead(asha, ist('2025-03-11 08:30')));
      const work = async (leadId: Types.ObjectId, from: string, status: string, when: string) =>
        activity.collection.insertOne({
          contact: new Types.ObjectId(), branch, user: asha, type: 'STATUS_UPDATE', source: 'LEAD',
          lead: leadId, from_status: from, to_status: status, created_at: ist(when),
        });
      await work(ids[6], 'FRESH', 'NOT_INTERESTED', '2025-03-11 10:00'); // carried lead worked
      await work(ids[7], 'FRESH', 'FREE_TRIAL', '2025-03-11 10:30'); // carried lead worked
      await work(ids[8], 'FRESH', 'SWITCHED_OFF', '2025-03-11 11:00'); // carried lead worked
      await work(ids[0], 'RINGING', 'CALLBACK', '2025-03-11 12:00'); // re-call of a day-1 lead
      await work(fresh5[0], 'FRESH', 'RINGING', '2025-03-11 13:00'); // one of the new leads

      const d2 = row(await day('2025-03-11'), 'asha');
      expect(nums(d2)).toMatchObject({
        assigned: 5,
        carried_forward: 4, // the 4 untouched at the start of day 2
        total_dialed: 5, // 3 carried + 1 re-called + 1 new
        callback: 1, not_interested: 1, free_trial: 1, switched_off: 1, ringing: 1,
        fresh: 5, // 4 carried + 5 new - 3 carried worked - 1 new worked
        total: 10,
      });

      // day 1 asked again, long after, is still exactly what it was
      const d1 = row(await day('2025-03-10'), 'asha');
      expect(nums(d1)).toMatchObject({
        assigned: 10, carried_forward: 0, fresh: 4, total: 10, total_dialed: 6,
        ringing: 1, callback: 2, payment_done: 2, dead: 1,
      });
    });

    it('a two-day range counts different leads worked once, each in the status it ended on', async () => {
      const ids: Types.ObjectId[] = (global as any).__ids;
      await activity.collection.insertOne({
        contact: new Types.ObjectId(), branch, user: asha, type: 'STATUS_UPDATE', source: 'LEAD',
        lead: ids[0], from_status: 'RINGING', to_status: 'CALLBACK', created_at: ist('2025-03-11 12:00'),
      });
      const r = row(await day('2025-03-10', '2025-03-11'), 'asha');
      expect(nums(r)).toMatchObject({
        assigned: 10, carried_forward: 0, fresh: 4,
        total_dialed: 6, // lead 0 was worked on both days but is one lead
        ringing: 0, callback: 3, // ... and ended the range in CALLBACK
        payment_done: 2, dead: 1,
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe('where a day starts and ends (8 AM to 8 AM India time)', () => {
    it('an event at 7:59 AM belongs to the day before, 8:00 AM starts the next', async () => {
      await lead(asha, ist('2025-03-10 09:00'), [['2025-03-11 07:59', 'DEAD']]); // still Monday
      await lead(asha, ist('2025-03-10 09:00'), [['2025-03-11 08:00', 'DEAD']]); // Tuesday
      const mon = row(await service.build({ userIds: everyone, from: '2025-03-10' }), 'asha');
      const tue = row(await service.build({ userIds: everyone, from: '2025-03-11' }), 'asha');
      expect(nums(mon)).toMatchObject({ assigned: 2, total_dialed: 1, dead: 1, fresh: 1 });
      expect(nums(tue)).toMatchObject({ assigned: 0, carried_forward: 1, total_dialed: 1, dead: 1, fresh: 0 });
    });

    it('a lead handed out at 11:30 PM counts for that attendance day', async () => {
      await lead(asha, ist('2025-03-10 23:30'));
      const mon = row(await service.build({ userIds: everyone, from: '2025-03-10' }), 'asha');
      expect(nums(mon).assigned).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('edge cases', () => {
    it('a repeat-payment row ("invest more") counts as worked and paid, not as assigned or fresh', async () => {
      await lead(asha, ist('2025-03-10 10:00'), [], { assignedStatus: 'PAYMENT_DONE' });
      const r = row(await service.build({ userIds: everyone, from: '2025-03-10' }), 'asha');
      expect(nums(r)).toMatchObject({ assigned: 0, fresh: 0, total_dialed: 1, payment_done: 1, total: 1 });
    });

    it('a lead put back to FRESH is untouched again, not dialed', async () => {
      await lead(asha, ist('2025-03-10 09:00'), [['2025-03-10 10:00', 'RINGING'], ['2025-03-10 11:00', 'FRESH']]);
      const r = row(await service.build({ userIds: everyone, from: '2025-03-10' }), 'asha');
      expect(nums(r)).toMatchObject({ assigned: 1, fresh: 1, total_dialed: 0, ringing: 0, total: 1 });
    });

    it('a deleted lead is not counted as waiting, but the call it had is still history', async () => {
      await lead(asha, ist('2025-03-10 09:00'), [], { deleted: true }); // untouched, then deleted
      await lead(asha, ist('2025-03-10 09:00'), [['2025-03-10 10:00', 'DEAD']], { deleted: true });
      const r = row(await service.build({ userIds: everyone, from: '2025-03-10' }), 'asha');
      expect(nums(r)).toMatchObject({ fresh: 0, total_dialed: 1, dead: 1 });
    });

    it('hot-lead activity is not part of this table', async () => {
      await lead(asha, ist('2025-03-10 09:00'), [['2025-03-10 10:00', 'DEAD']], { source: 'HOT_LEAD' });
      const res = await service.build({ userIds: everyone, from: '2025-03-10' });
      expect(res.result).toEqual([]);
    });

    it('only the people asked for are included, and other companies stay out', async () => {
      await lead(asha, ist('2025-03-10 09:00'));
      await lead(outsider, ist('2025-03-10 09:00'), [], { branch: otherBranch });
      const res = await service.build({ userIds: everyone, from: '2025-03-10' });
      expect(res.result.map((r: any) => r.userDetails.username)).toEqual(['asha']);
      const only = await service.build({ userIds: [String(outsider)], from: '2025-03-10' });
      expect(only.result.map((r: any) => r.userDetails.username)).toEqual(['outsider']);
    });

    it('people with nothing to show have no row; an empty period is an empty table', async () => {
      await lead(asha, ist('2025-03-10 09:00'));
      expect((await service.build({ userIds: everyone, from: '2025-06-01' })).total).toBe(1); // asha's lead is still untouched
      await userLeads.deleteMany({});
      const none = await service.build({ userIds: everyone, from: '2025-06-01' });
      expect(none).toMatchObject({ total: 0, result: [] });
    });

    it('with no dates it is the current attendance day', async () => {
      await lead(asha, new Date()); // handed out just now
      const res = await service.build({ userIds: everyone });
      expect(res.range.from).toBe(res.range.to);
      expect(nums(row(res, 'asha'))).toMatchObject({ assigned: 1, fresh: 1, total: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  describe('filters for admin and superadmin', () => {
    beforeEach(async () => {
      await lead(asha, ist('2025-03-10 09:00'), [['2025-03-10 10:00', 'DEAD']]);
      await lead(ravi, ist('2025-03-10 09:00'));
      await lead(meena, ist('2025-03-10 09:00'), [['2025-03-10 10:00', 'RINGING']]);
      await attendance.recordLogin(String(asha), String(branch), ist('2025-03-10 08:10'));
      await attendance.recordLogin(String(ravi), String(branch), ist('2025-03-10 08:40'));
      await attendance.recordLogin(String(asha), String(branch), ist('2025-03-11 08:20'));
      // meena never logged in; a fourth person (outsider) logged in but has no leads
      await attendance.recordLogin(String(outsider), String(branch), ist('2025-03-10 09:00'));
    });

    const names = (res: any) => res.result.map((r: any) => r.userDetails.username);
    const q = (extra: any) => service.build({ userIds: [...everyone, String(outsider)], from: '2025-03-10', ...extra });

    it('username search: contains, any case, and the text is not a pattern', async () => {
      expect(names(await q({ q: 'ASH' }))).toEqual(['asha']);
      expect(names(await q({ q: 'rav' }))).toEqual(['Ravi']);
      expect(names(await q({ q: 'a' }))).toEqual(['asha', 'meena.k', 'Ravi']);
      expect(names(await q({ q: 'meena.' }))).toEqual(['meena.k']);
      expect(names(await q({ q: '.*' }))).toEqual([]);
      expect(names(await q({ q: '(' }))).toEqual([]);
      expect(names(await q({ q: '   ' }))).toEqual(['asha', 'meena.k', 'Ravi']);
      expect(names(await q({ q: 'zzz' }))).toEqual([]);
    });

    it('"only logged in" lists whoever logged in that day, including people with zero leads', async () => {
      const res = await q({ loggedInOnly: true });
      expect(names(res)).toEqual(['asha', 'outsider', 'Ravi']); // meena did not log in
      const quiet = row(res, 'outsider');
      expect(nums(quiet)).toMatchObject({ total: 0, total_dialed: 0, fresh: 0, assigned: 0, carried_forward: 0 });
    });

    it('"only logged in" leaves out people who did not log in even though they have leads', async () => {
      const res = await q({ loggedInOnly: true });
      expect(names(res)).not.toContain('meena.k');
      const all = await q({});
      expect(names(all)).toContain('meena.k');
    });

    it('the logged-in list follows the chosen day or range', async () => {
      expect(names(await q({ loggedInOnly: true, from: '2025-03-11', to: '2025-03-11' }))).toEqual(['asha']);
      expect(names(await q({ loggedInOnly: true, from: '2025-03-12', to: '2025-03-12' }))).toEqual([]);
      expect(names(await q({ loggedInOnly: true, from: '2025-03-10', to: '2025-03-11' }))).toEqual(['asha', 'outsider', 'Ravi']);
    });

    it('both filters together', async () => {
      expect(names(await q({ loggedInOnly: true, q: 'a' }))).toEqual(['asha', 'Ravi']);
    });

    it('rows carry the first login and the days present', async () => {
      const one = row(await q({}), 'asha');
      expect(one.attendance.first_login_at).toEqual(ist('2025-03-10 08:10'));
      expect(one.attendance.days_present).toBe(1);
      const range = row(await q({ from: '2025-03-10', to: '2025-03-11' }), 'asha');
      expect(range.attendance.first_login_at).toEqual(ist('2025-03-10 08:10'));
      expect(range.attendance.days_present).toBe(2);
      expect(row(await q({}), 'meena.k').attendance).toBeNull();
    });

    it('paging: sorted by name ignoring case, total is the whole list', async () => {
      const p0 = await q({ size: 2, page: 0 });
      const p1 = await q({ size: 2, page: 1 });
      expect(p0.total).toBe(3);
      expect(names(p0)).toEqual(['asha', 'meena.k']);
      expect(names(p1)).toEqual(['Ravi']);
    });
  });

  // ---------------------------------------------------------------------------
  describe('same numbers as the old smart view for today', () => {
    // Builds leads in every kind of state, writes both the activity and the row
    // (as the app does), then compares with the previous implementation.
    it('matches for a mixed, repeatable set of leads', async () => {
      let seed = 12345;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
      };
      const statuses = ['CALLBACK', 'FREE_TRIAL', 'RINGING', 'SWITCHED_OFF', 'DEAD', 'NOT_REACHABLE', 'NOT_INTERESTED', 'EXPECTED_PAYMENT', 'PAYMENT_DONE'];
      const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);

      for (const person of [asha, ravi, meena]) {
        for (let i = 0; i < 40; i++) {
          const kind = rnd(5);
          const _id = new Types.ObjectId();
          const contact = new Types.ObjectId();
          const events: any[] = [];
          let status = 'FRESH';
          let updatedAt: Date;

          if (kind === 0) {
            // an old lead, never touched (carried forward from days ago)
            const when = new Date(Date.now() - (2 + rnd(5)) * 24 * 3600 * 1000);
            events.push({ contact, branch, user: person, type: 'ASSIGNED', source: 'LEAD', lead: _id, to_status: 'FRESH', created_at: when });
            updatedAt = when;
          } else if (kind === 1) {
            // handed out today, untouched
            const when = minutesAgo(5 + rnd(4));
            events.push({ contact, branch, user: person, type: 'ASSIGNED', source: 'LEAD', lead: _id, to_status: 'FRESH', created_at: when });
            updatedAt = when;
          } else if (kind === 2) {
            // handed out earlier, worked today
            const assigned = new Date(Date.now() - (1 + rnd(3)) * 24 * 3600 * 1000);
            const when = minutesAgo(1 + rnd(3));
            status = statuses[rnd(statuses.length)];
            events.push({ contact, branch, user: person, type: 'ASSIGNED', source: 'LEAD', lead: _id, to_status: 'FRESH', created_at: assigned });
            events.push({ contact, branch, user: person, type: 'STATUS_UPDATE', source: 'LEAD', lead: _id, from_status: 'FRESH', to_status: status, created_at: when });
            updatedAt = when;
          } else if (kind === 3) {
            // worked twice today
            const assigned = minutesAgo(9);
            const first = statuses[rnd(statuses.length)];
            status = statuses[rnd(statuses.length)];
            events.push({ contact, branch, user: person, type: 'ASSIGNED', source: 'LEAD', lead: _id, to_status: 'FRESH', created_at: assigned });
            events.push({ contact, branch, user: person, type: 'STATUS_UPDATE', source: 'LEAD', lead: _id, from_status: 'FRESH', to_status: first, created_at: minutesAgo(4) });
            events.push({ contact, branch, user: person, type: 'STATUS_UPDATE', source: 'LEAD', lead: _id, from_status: first, to_status: status, created_at: minutesAgo(2) });
            updatedAt = minutesAgo(2);
          } else {
            // worked yesterday, not today
            const assigned = new Date(Date.now() - 3 * 24 * 3600 * 1000);
            const when = new Date(Date.now() - 20 * 3600 * 1000);
            status = statuses[rnd(statuses.length)];
            events.push({ contact, branch, user: person, type: 'ASSIGNED', source: 'LEAD', lead: _id, to_status: 'FRESH', created_at: assigned });
            events.push({ contact, branch, user: person, type: 'STATUS_UPDATE', source: 'LEAD', lead: _id, from_status: 'FRESH', to_status: status, created_at: when });
            updatedAt = when;
          }

          await activity.collection.insertMany(events);
          await userLeads.collection.insertOne({
            _id, user: person, branch, mobile: String(9000000000 + counter++), status, is_hot_lead: false,
            created_at: events[0].created_at, updated_at: updatedAt,
          });
        }
      }

      const old = new UserLeadsService(userLeads as any, {} as any, {} as any);
      const before = await old.getStatusCountByUser({ user: everyone, page: 0, size: 50 });
      const after = await service.build({ userIds: everyone });

      expect(after.total).toBe(before.total);
      for (const b of before.result as any[]) {
        const a = after.result.find((r: any) => r.user === String(b.user));
        expect(a).toBeTruthy();
        const who = b.userDetails.username;
        const same = (label: string, now: number, then: number) => {
          if (now !== then) {
            throw new Error(`${who} ${label}: old ${then}, new ${now}`);
          }
        };
        // every column the old table had, except Total (see below)
        for (const key of Object.keys(b.status).filter((k) => k !== 'total')) {
          same(key, a.status[key], b.status[key]);
        }
        // The old "Total" column only ever counted the fresh leads (it was always
        // equal to Fresh). The new Total is everything the person had in hand:
        // fresh + dialed.
        same('old total vs fresh', a.status.fresh, b.status.total);
        same('new total', a.status.total, b.status.fresh + b.status.total_dialed);
      }
      // and it really exercised every column
      expect(after.result.reduce((n: number, r: any) => n + r.status.total_dialed, 0)).toBeGreaterThan(20);
      expect(after.result.reduce((n: number, r: any) => n + r.status.fresh, 0)).toBeGreaterThan(20);
    }, 60000);
  });
});
