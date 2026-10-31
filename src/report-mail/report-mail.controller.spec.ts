import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { BranchSchema } from 'src/branches/branch.schema';
import { EmailService } from 'src/email/email.service';
import { ReportMailModule } from './report-mail.module';

// Runs through the real controller and a throwaway MongoDB.
// Set TEST_MONGO_URI; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

describeDb('/report-mail', () => {
  let app: INestApplication;
  let server: any;
  let m: Record<string, Model<any>>;
  const email = { sendHtml: jest.fn(), sendMail: jest.fn(), isConfigured: jest.fn() };

  const A = new Types.ObjectId();
  const B = new Types.ObjectId();
  const id = () => new Types.ObjectId();
  const people = {
    adminA: { userId: String(id()), role: 'admin', branch: String(A), username: 'adminA' },
    adminB: { userId: String(id()), role: 'admin', branch: String(B), username: 'adminB' },
    root: { userId: String(id()), role: 'superadmin', branch: String(A), username: 'root' },
    tlA: { userId: String(id()), role: 'teamlead', branch: String(A), username: 'tlA' },
    staffA: { userId: String(id()), role: 'employee', branch: String(A), username: 'staffA' },
  };
  type Who = keyof typeof people;

  const fakeGuard = {
    canActivate: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      const raw = req.headers['x-test-user'];
      if (!raw) throw new UnauthorizedException();
      const p = people[String(raw)];
      req.user = { ...p, branch: { _id: p.branch } };
      return true;
    },
  };
  const call = (who: Who | null, method: 'get' | 'put' | 'post', url: string, body?: any) => {
    const r = (request(server) as any)[method](url);
    if (who) r.set('x-test-user', who);
    return body === undefined ? r : r.send(body);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([{ name: 'Branch', schema: BranchSchema }]),
        ReportMailModule,
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue(fakeGuard)
      .overrideProvider(EmailService).useValue(email)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    m = {
      setting: app.get(getModelToken('ReportMailSetting')),
      log: app.get(getModelToken('ReportMailLog')),
      branch: app.get(getModelToken('Branch')),
      user: app.get(getModelToken('User')),
    };
    await Promise.all([m.setting.init(), m.log.init()]);
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await app?.close();
  }, 60000);

  beforeEach(async () => {
    jest.clearAllMocks();
    email.isConfigured.mockReturnValue(true);
    email.sendHtml.mockResolvedValue(undefined);
    await Promise.all(Object.values(m).map((model) => model.deleteMany({})));
    await m.branch.collection.insertMany([
      { _id: A, name: 'Company A', status: 'Active', expiry_date: new Date('2099-01-01') },
      { _id: B, name: 'Company B', status: 'Active', expiry_date: new Date('2099-01-01') },
    ] as any);
    await m.user.collection.insertMany([
      { _id: new Types.ObjectId(people.adminA.userId), username: 'adminA', role: 'admin', email: 'admin.a@example.com', branch: A },
      { _id: new Types.ObjectId(people.adminB.userId), username: 'adminB', role: 'admin', email: 'admin.b@example.com', branch: B },
    ] as any);
  });

  describe('who may use it', () => {
    it('needs a login', async () => {
      await call(null, 'get', '/report-mail/settings').expect(401);
      await call(null, 'put', '/report-mail/settings', {}).expect(401);
      await call(null, 'post', '/report-mail/test').expect(401);
      await call(null, 'get', '/report-mail/logs').expect(401);
    });

    it('team leads and staff may not', async () => {
      for (const who of ['tlA', 'staffA'] as Who[]) {
        await call(who, 'get', '/report-mail/settings').expect(403);
        await call(who, 'put', '/report-mail/settings', { enabled: false }).expect(403);
        await call(who, 'post', '/report-mail/test').expect(403);
        await call(who, 'get', '/report-mail/logs').expect(403);
      }
    });

    it('an admin works on their own company only, even when asking for another', async () => {
      await call('adminA', 'put', `/report-mail/settings?branch=${B}`, { enabled: true, recipients: ['a-only@x.com'] }).expect(200);
      expect((await call('adminA', 'get', `/report-mail/settings?branch=${B}`).expect(200)).body.recipients).toEqual(['a-only@x.com']);
      expect(await m.setting.countDocuments({ branch: B })).toBe(0); // company B untouched
      expect((await call('adminB', 'get', '/report-mail/settings').expect(200)).body.recipients).toEqual(['admin.b@example.com']);
    });

    it('superadmin has to say which company, then can use any', async () => {
      await call('root', 'get', '/report-mail/settings').expect(400);
      await call('root', 'get', '/report-mail/settings?branch=not-an-id').expect(400);
      const b = await call('root', 'put', `/report-mail/settings?branch=${B}`, { enabled: true, recipients: ['b@x.com'] }).expect(200);
      expect(b.body.recipients).toEqual(['b@x.com']);
      expect(await m.setting.countDocuments({ branch: B })).toBe(1);
      expect(await m.setting.countDocuments({ branch: A })).toBe(0);
    });
  });

  describe('settings', () => {
    it('first time: defaults with the admin\'s address ready, not yet saved', async () => {
      const res = await call('adminA', 'get', '/report-mail/settings').expect(200);
      expect(res.body).toMatchObject({
        saved: false, enabled: false, recipients: ['admin.a@example.com'],
        from_hour: 9, to_hour: 23, only_logged_in: false, skip_if_unchanged: false,
      });
    });

    it('saving, then reading it back', async () => {
      const put = await call('adminA', 'put', '/report-mail/settings', {
        enabled: true, recipients: ['Boss@x.com', 'owner@x.com'], from_hour: 10, to_hour: 20,
        only_logged_in: true, skip_if_unchanged: true,
      }).expect(200);
      expect(put.body).toMatchObject({ saved: true, enabled: true, recipients: ['boss@x.com', 'owner@x.com'], from_hour: 10, to_hour: 20, only_logged_in: true, skip_if_unchanged: true });
      const get = await call('adminA', 'get', '/report-mail/settings').expect(200);
      expect(get.body).toMatchObject(put.body);
      expect((await m.setting.findOne({ branch: A }).lean<any>()).updated_by.toString()).toBe(people.adminA.userId);
    });

    it('bad input is refused with a message and saves nothing', async () => {
      const cases: [any, RegExp][] = [
        [{ enabled: true, recipients: [] }, /at least one email address/],
        [{ recipients: ['nope'] }, /not a valid email address/],
        [{ recipients: Array.from({ length: 11 }, (_, i) => `p${i}@x.com`) }, /At most 10/],
        [{ from_hour: 25 }, /whole hour/],
        [{ from_hour: 20, to_hour: 5 }, /must not be after/],
        [{ enabled: 'yes' }, /true or false/],
        [{ recipients: 'a@x.com' }, /list of email addresses/],
      ];
      for (const [body, message] of cases) {
        const res = await call('adminA', 'put', '/report-mail/settings', body).expect(400);
        expect(JSON.stringify(res.body.message)).toMatch(message);
      }
      expect(await m.setting.countDocuments({})).toBe(0);
    });

    it('an empty body changes nothing and does not break', async () => {
      await call('adminA', 'put', '/report-mail/settings').send().expect(200);
    });
  });

  describe('send test email now', () => {
    beforeEach(() => call('adminA', 'put', '/report-mail/settings', { enabled: true, recipients: ['boss@x.com', 'owner@x.com'] }).expect(200));

    it('sends to the saved list and tells who got it', async () => {
      const res = await call('adminA', 'post', '/report-mail/test').expect(201);
      expect(res.body.sent_to).toEqual(['boss@x.com', 'owner@x.com']);
      expect(res.body.subject).toContain('[TEST] Smart view - Company A');
      expect(email.sendHtml).toHaveBeenCalledTimes(1);
      expect(email.sendHtml.mock.calls[0][0].to).toEqual(['boss@x.com', 'owner@x.com']);
      expect((await call('adminA', 'get', '/report-mail/settings').expect(200)).body.last_status).toBe('SENT');
    });

    it('a mail server problem is reported with its reason', async () => {
      email.sendHtml.mockRejectedValue(new Error('535 Authentication failed'));
      const res = await call('adminA', 'post', '/report-mail/test').expect(502);
      expect(res.body.message).toContain('535 Authentication failed');
      const settings = (await call('adminA', 'get', '/report-mail/settings').expect(200)).body;
      expect(settings.last_status).toBe('FAILED');
      expect(settings.last_error).toBe('535 Authentication failed');
    });

    it('says so when mail is not set up on this server', async () => {
      email.isConfigured.mockReturnValue(false);
      const res = await call('adminA', 'post', '/report-mail/test').expect(400);
      expect(res.body.message).toContain('Mail is not set up on this server');
    });

    it('needs saved settings first', async () => {
      await m.setting.deleteMany({});
      const res = await call('adminB', 'post', '/report-mail/test').expect(400);
      expect(res.body.message).toContain('Save at least one email address first');
    });

    it('sends only to the caller\'s own company', async () => {
      await call('adminB', 'put', '/report-mail/settings', { enabled: false, recipients: ['b@x.com'] }).expect(200);
      await call('adminB', 'post', `/report-mail/test?branch=${A}`).expect(201);
      expect(email.sendHtml.mock.calls[0][0].to).toEqual(['b@x.com']);
    });
  });

  describe('history', () => {
    it('shows the company\'s recent mails and nobody else\'s', async () => {
      await m.log.collection.insertMany([
        { branch: A, slot: '2025-03-10 14', status: 'SENT', recipients_count: 2, created_at: new Date('2025-03-10T08:30:00Z') },
        { branch: A, slot: '2025-03-10 15', status: 'FAILED', error: 'down', recipients_count: 2, created_at: new Date('2025-03-10T09:30:00Z') },
        { branch: B, slot: '2025-03-10 14', status: 'SENT', recipients_count: 1, created_at: new Date('2025-03-10T08:30:00Z') },
      ] as any);
      const res = await call('adminA', 'get', '/report-mail/logs').expect(200);
      expect(res.body.map((r: any) => r.slot)).toEqual(['2025-03-10 15', '2025-03-10 14']);
      expect(res.body[0]).toMatchObject({ status: 'FAILED', error: 'down' });
    });
  });
});
