import { INestApplication } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { EmailService } from 'src/email/email.service';
import { attendanceDate } from 'src/common/time.util';
import { ContactsService } from 'src/contacts/contacts.service';
import { Branch, BranchSchema } from 'src/branches/branch.schema';
import { DashboardModule } from 'src/dashboard/dashboard.module';
import { CampaignsModule } from './campaigns.module';
import { CampaignsService } from './campaigns.service';

// The Campaign Report page: campaigns are run through the real service, the
// report is read through the real /dashboard/reports route. Needs TEST_MONGO_URI.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

describeDb('campaign report (/dashboard/reports?campaign_report=true)', () => {
  let app: INestApplication;
  let server: any;
  let service: CampaignsService;
  let contacts: ContactsService;
  let m: Record<string, Model<any>>;

  const A = new Types.ObjectId();
  const B = new Types.ObjectId();
  const id = () => new Types.ObjectId();
  let staffA: any[] = [];
  let staffB: any[] = [];
  let adminA: any, adminB: any, root: any, tlA: any;

  const ctxA = () => ({ branch: String(A), actorId: String(adminA._id), actorName: 'adminA' });
  const ctxB = () => ({ branch: String(B), actorId: String(adminB._id), actorName: 'adminB' });

  // Logged in as whoever the 'as' header names; by default the person the report is about.
  const guard = {
    canActivate: async (ctx: any) => {
      const req = ctx.switchToHttp().getRequest();
      const who = String(req.headers['x-test-as'] ?? req.query.user ?? '');
      const u: any = who ? await m.User.collection.findOne({ _id: new Types.ObjectId(who) }) : null;
      if (!u) return false;
      req.user = { userId: String(u._id), role: u.role, branch: u.branch ? { _id: String(u.branch) } : undefined, username: u.username };
      return true;
    },
  };
  const report = (query: Record<string, any>, loggedInAs?: any) => {
    const r = request(server).get('/dashboard/reports').query({ page: 0, size: 500, ...query });
    return loggedInAs ? r.set('x-test-as', String(loggedInAs._id)) : r;
  };
  const asAdminA = (q: Record<string, any> = {}) => report({ user: String(adminA._id), campaign_report: true, ...q });

  const makeUsers = async (n: number, branch: Types.ObjectId, prefix: string, teamlead?: any) => {
    const rows = Array.from({ length: n }, (_, i) => ({
      _id: id(), first_name: 'F' + i, last_name: 'L' + i, email: `${prefix}${i}@x.com`,
      username: `${prefix}${i}`, password: 'x', password_text: 'x', branch, role: 'employee',
      ...(teamlead ? { teamlead: teamlead._id } : {}),
    }));
    await m.User.insertMany(rows);
    return rows;
  };
  const fillPool = async (n: number, branch: Types.ObjectId, start: number) => {
    const resolved = await contacts.resolve(String(branch), Array.from({ length: n }, (_, i) => ({ mobile: String(9000000000 + start + i) })));
    await m.Lead.insertMany(resolved.rows.map((r: any) => ({ contact: r.contact._id, mobile: r.mobile, branch })));
  };
  const present = (users: any[]) =>
    m.Attendance.insertMany(users.map((u) => ({ user: u._id, branch: u.branch, date: attendanceDate(), first_login_at: new Date(), last_login_at: new Date(), login_count: 1 })));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(uri + '_campaign_report'), CampaignsModule, DashboardModule, MongooseModule.forFeature([{ name: Branch.name, schema: BranchSchema }])],
    })
      .overrideGuard(JwtAuthGuard).useValue(guard)
      .overrideProvider(EmailService).useValue({ sendHtml: jest.fn(), sendMail: jest.fn(), isConfigured: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    service = app.get(CampaignsService);
    contacts = app.get(ContactsService);
    m = {
      Campaign: app.get(getModelToken('Campaign')),
      Lead: app.get(getModelToken('Lead')),
      UserLead: app.get(getModelToken('UserLead')),
      User: app.get(getModelToken('User')),
      Attendance: app.get(getModelToken('Attendance')),
      Branch: app.get(getModelToken(Branch.name)),
    };
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await Promise.all(Object.values(m).map((x) => x.deleteMany({})));
    await m.Campaign.db.collection('campaignleads').deleteMany({});
    await m.Campaign.db.collection('leadactivities').deleteMany({});
    await m.Branch.collection.insertMany([{ _id: A, name: 'Company A' }, { _id: B, name: 'Company B' }] as any);
    [adminA] = await m.User.insertMany([{ _id: id(), first_name: 'A', last_name: 'A', email: 'a@x.com', username: 'adminA', password: 'x', password_text: 'x', branch: A, role: 'admin' }]);
    [adminB] = await m.User.insertMany([{ _id: id(), first_name: 'B', last_name: 'B', email: 'b@x.com', username: 'adminB', password: 'x', password_text: 'x', branch: B, role: 'admin' }]);
    root = { _id: id(), username: 'root', role: 'superadmin' };
    await m.User.collection.insertOne(root);
    [tlA] = await m.User.insertMany([{ _id: id(), first_name: 'T', last_name: 'T', email: 't@x.com', username: 'tlA', password: 'x', password_text: 'x', branch: A, role: 'teamlead' }]);
    staffA = await makeUsers(4, A, 'sa');
    staffB = await makeUsers(2, B, 'sb');
    await present([...staffA, ...staffB]);
  });

  /** campaign of `count` leads over the first `people` staff of company A; returns its id */
  const start = async (name: string, count: number, people = 4, pool = true) => {
    if (pool) await fillPool(count, A, Math.floor(Math.random() * 1e6) * 100);
    const made: any = await service.create(ctxA(), { name, staff: staffA.slice(0, people).map((s) => String(s._id)), count });
    return String(made._id ?? made.id);
  };
  const next = (campaignId: string, input: any = {}) => service.nextRound(campaignId, ctxA(), input);

  describe('what the report lists', () => {
    it('lists every hand-out of a campaign with its campaign name and round, and nothing else', async () => {
      const c = await start('Diwali', 8);
      // an ordinary lead handed out by hand sits next to the campaign
      await m.UserLead.create({ user: staffA[0]._id, branch: A, contact: id(), mobile: '8111111111', status: 'FRESH' });

      const res = await asAdminA().expect(200);
      expect(res.body.total).toBe(8);
      expect(res.body.data).toHaveLength(8);
      for (const row of res.body.data) {
        expect(row.campaign_name).toBe('Diwali');
        expect(row.campaign_round).toBe(1);
        expect(row.userDetails.username).toMatch(/^sa/);
      }
      expect(res.body.data.some((r: any) => r.mobile === '8111111111')).toBe(false);
      void c;
    });

    it('a normal (non-campaign) report is unchanged and still lists the hand-made lead', async () => {
      await start('Diwali', 8);
      await m.UserLead.create({ user: staffA[0]._id, branch: A, contact: id(), mobile: '8111111111', status: 'FRESH' });
      const res = await report({ user: String(adminA._id) }).expect(200);
      expect(res.body.total).toBe(9);
      expect(res.body.data[0].campaign_name).toBeUndefined();
    });

    it('every round adds another line per lead; the round filter splits them cleanly', async () => {
      const c = await start('Rounds', 8);
      await m.UserLead.updateMany({ campaign: c }, { $set: { status: 'RINGING' } });
      await next(c);
      await m.UserLead.updateMany({ campaign: c, campaign_round: 2 }, { $set: { status: 'CALLBACK' } });
      await next(c);

      const all = await asAdminA().expect(200);
      expect(all.body.total).toBe(24); // 8 leads x 3 rounds

      for (const round of [1, 2, 3]) {
        const r = await asAdminA({ campaign_round: round }).expect(200);
        expect(r.body.total).toBe(8);
        expect(r.body.data.every((x: any) => x.campaign_round === round)).toBe(true);
      }
      const none = await asAdminA({ campaign_round: 4 }).expect(200);
      expect(none.body.total).toBe(0);
    });

    it('a lead that stayed with its holder in a round has no extra line for that round', async () => {
      const c = await start('Stay', 8);
      const rows = await m.UserLead.find({ campaign: c }).sort({ _id: 1 });
      await m.UserLead.updateOne({ _id: rows[0]._id }, { $set: { status: 'RINGING' } });
      await next(c, { move_statuses: ['RINGING'] });
      const r2 = await asAdminA({ campaign_round: 2 }).expect(200);
      expect(r2.body.total).toBe(1);
      const r1 = await asAdminA({ campaign_round: 1 }).expect(200);
      expect(r1.body.total).toBe(8);
    });

    it('each line shows the status the staff gave it', async () => {
      const c = await start('Status', 8);
      const rows = await m.UserLead.find({ campaign: c }).sort({ _id: 1 });
      await m.UserLead.updateOne({ _id: rows[0]._id }, { $set: { status: 'PAYMENT_DONE' } });
      await m.UserLead.updateOne({ _id: rows[1]._id }, { $set: { status: 'DEAD' } });

      const paid = await asAdminA({ status: 'PAYMENT_DONE' }).expect(200);
      expect(paid.body.total).toBe(1);
      expect(String(paid.body.data[0]._id)).toBe(String(rows[0]._id));
      const fresh = await asAdminA({ status: 'FRESH' }).expect(200);
      expect(fresh.body.total).toBe(6);
    });
  });

  describe('filters', () => {
    it('by campaign: the dropdown list and the id filter agree', async () => {
      const c1 = await start('One', 4);
      const c2 = await start('Two', 6);
      const list = await service.options(String(A));
      expect(list.map((x: any) => x.name).sort()).toEqual(['One', 'Two']);

      expect((await asAdminA({ campaign_id: c1 }).expect(200)).body.total).toBe(4);
      expect((await asAdminA({ campaign_id: c2 }).expect(200)).body.total).toBe(6);
      expect((await asAdminA().expect(200)).body.total).toBe(10);
    });

    it('by campaign name: partial, any case, and special characters are taken literally', async () => {
      await start('Diwali Sale (A+)', 4);
      await start('Holi', 4);
      expect((await asAdminA({ campaign_name: 'diwali' }).expect(200)).body.total).toBe(4);
      expect((await asAdminA({ campaign_name: '(A+)' }).expect(200)).body.total).toBe(4);
      expect((await asAdminA({ campaign_name: '.*' }).expect(200)).body.total).toBe(0);
      expect((await asAdminA({ campaign_name: 'nothing' }).expect(200)).body.total).toBe(0);
      expect((await asAdminA({ campaign_name: '  ' }).expect(200)).body.total).toBe(8);
    });

    it('by person: each person sees their own lines in the report', async () => {
      await start('P', 8);
      const res = await asAdminA().expect(200);
      const perUser: Record<string, number> = {};
      res.body.data.forEach((x: any) => { perUser[x.userDetails.username] = (perUser[x.userDetails.username] ?? 0) + 1; });
      expect(perUser).toEqual({ sa0: 2, sa1: 2, sa2: 2, sa3: 2 });
    });

    it('by date range: from and to cut on when the lead was handed out', async () => {
      const c = await start('Dates', 8);
      const rows = await m.UserLead.find({ campaign: c }).sort({ _id: 1 });
      const days = ['2026-01-10T05:00:00Z', '2026-01-10T20:00:00Z', '2026-01-11T05:00:00Z'];
      await m.UserLead.collection.updateOne({ _id: rows[0]._id }, { $set: { created_at: new Date(days[0]) } });
      await m.UserLead.collection.updateOne({ _id: rows[1]._id }, { $set: { created_at: new Date(days[1]) } });
      await m.UserLead.collection.updateOne({ _id: rows[2]._id }, { $set: { created_at: new Date(days[2]) } });

      const from = await asAdminA({ from: '2026-01-10T00:00:00Z', to: '2026-01-10T23:59:59Z' }).expect(200);
      expect(from.body.total).toBe(2);
      const onlyLater = await asAdminA({ from: '2026-01-11T00:00:00Z', to: '2026-01-12T00:00:00Z' }).expect(200);
      expect(onlyLater.body.total).toBe(1);
    });

    it('hot / normal type filter works on a hot campaign', async () => {
      const resolved = await contacts.resolve(String(A), Array.from({ length: 4 }, (_, i) => ({ mobile: String(9600000000 + i) })));
      await m.Lead.db.collection('hotleads').insertMany(
        resolved.rows.map((r: any) => ({ contact: r.contact._id, mobile: r.mobile, branch: A })),
      );
      await start('Normal', 4);
      await service.create(ctxA(), { name: 'Hot', staff: staffA.slice(0, 2).map((s) => String(s._id)), count: 4, lead_type: 'HOT' });

      expect((await asAdminA({ lead_type: 'hot_lead' }).expect(200)).body.total).toBe(4);
      expect((await asAdminA({ lead_type: 'normal_lead' }).expect(200)).body.total).toBe(4);
      expect((await asAdminA().expect(200)).body.total).toBe(8);
    });

    it('bad filters are refused with a clear 400', async () => {
      await start('X', 4);
      await asAdminA({ campaign_id: 'nope' }).expect(400);
      await asAdminA({ campaign_round: 'abc' }).expect(400);
      await asAdminA({ campaign_round: 0 }).expect(400);
      await asAdminA({ campaign_round: -1 }).expect(400);
      await asAdminA({ campaign_round: 1.5 }).expect(400);
    });

    it('a campaign id of another company shows nothing', async () => {
      await fillPool(4, B, 5000);
      const made: any = await service.create(ctxB(), { name: 'Theirs', staff: staffB.map((s) => String(s._id)), count: 4 });
      const res = await asAdminA({ campaign_id: String(made._id ?? made.id) }).expect(200);
      expect(res.body.total).toBe(0);
    });
  });

  describe('paging and Excel', () => {
    it('pages add up to the total, no line twice', async () => {
      await start('Pages', 30);
      const seen = new Set<string>();
      for (let page = 0; page < 3; page++) {
        const r = await asAdminA({ page, size: 10 }).expect(200);
        expect(r.body.total).toBe(30);
        expect(r.body.data).toHaveLength(10);
        r.body.data.forEach((x: any) => seen.add(String(x._id)));
      }
      expect(seen.size).toBe(30);
      expect((await asAdminA({ page: 3, size: 10 }).expect(200)).body.data).toHaveLength(0);
    });

    it('excel mode returns everything at once', async () => {
      await start('Excel', 30);
      const r = await asAdminA({ excel: true, size: 10 }).expect(200);
      expect(r.body.data).toHaveLength(30);
      expect(r.body.total).toBe(30);
    });
  });

  describe('who can see what', () => {
    it('staff are refused', async () => {
      await start('S', 4);
      await report({ user: String(staffA[0]._id), campaign_report: true }).expect(403);
    });

    it('admin sees only their own company, even if they ask for another', async () => {
      await start('Mine', 4);
      await fillPool(4, B, 7000);
      await service.create(ctxB(), { name: 'Theirs', staff: staffB.map((s) => String(s._id)), count: 4 });

      const mine = await asAdminA({ branch: String(B) }).expect(200);
      expect(mine.body.total).toBe(4);
      expect(mine.body.data.every((x: any) => x.campaign_name === 'Mine')).toBe(true);
      const theirs = await report({ user: String(adminB._id), campaign_report: true }).expect(200);
      expect(theirs.body.total).toBe(4);
      expect(theirs.body.data.every((x: any) => x.campaign_name === 'Theirs')).toBe(true);
    });

    it('superadmin must name a company, then sees only that company', async () => {
      await start('Mine', 4);
      await fillPool(4, B, 7000);
      await service.create(ctxB(), { name: 'Theirs', staff: staffB.map((s) => String(s._id)), count: 4 });

      await report({ user: String(root._id), campaign_report: true }).expect(400);
      await report({ user: String(root._id), campaign_report: true, branch: 'junk' }).expect(400);
      const a = await report({ user: String(root._id), campaign_report: true, branch: String(A) }).expect(200);
      expect(a.body.total).toBe(4);
      expect(a.body.data.every((x: any) => x.campaign_name === 'Mine')).toBe(true);
      const b = await report({ user: String(root._id), campaign_report: true, branch: String(B) }).expect(200);
      expect(b.body.data.every((x: any) => x.campaign_name === 'Theirs')).toBe(true);
    });

    it('team lead sees only the lines of their own team (and themself)', async () => {
      await m.User.updateMany({ _id: { $in: [staffA[0]._id, staffA[1]._id] } }, { $set: { teamlead: tlA._id } });
      await start('Team', 8);
      const res = await report({ user: String(tlA._id), campaign_report: true, page: 0, size: 500 }).expect(200);
      const mine = await m.UserLead.countDocuments({ user: { $in: [staffA[0]._id, staffA[1]._id] }, campaign: { $exists: true } });
      expect(res.body.total).toBe(mine);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.total).toBeLessThan(8);
      expect(res.body.data.every((x: any) => ['sa0', 'sa1'].includes(x.userDetails.username))).toBe(true);
    });
  });

  describe('cannot borrow identity', () => {
    it('staff cannot read the campaign report by naming an admin in the address', async () => {
      await start('Secret', 4);
      await report({ user: String(adminA._id), campaign_report: true }, staffA[0]).expect(403);
    });

    it('an admin cannot read another company campaign report by naming its admin', async () => {
      await fillPool(4, B, 7000);
      await service.create(ctxB(), { name: 'Theirs', staff: staffB.map((s) => String(s._id)), count: 4 });
      await report({ user: String(adminB._id), campaign_report: true }, adminA).expect(403);
    });

    it('a team lead cannot read the whole company by naming an admin', async () => {
      await start('Whole', 4);
      await report({ user: String(adminA._id), campaign_report: true }, tlA).expect(403);
    });

    it('a team lead cannot read another team lead report, but can read their own', async () => {
      const [other] = await m.User.insertMany([{ _id: id(), first_name: 'O', last_name: 'T', email: 'o@x.com', username: 'tl2', password: 'x', password_text: 'x', branch: A, role: 'teamlead' }]);
      await start('Mine', 4);
      await report({ user: String(other._id), campaign_report: true }, tlA).expect(403);
      await report({ user: String(tlA._id), campaign_report: true }, tlA).expect(200);
    });

    it('an admin may still read the report of their own team lead', async () => {
      await start('Fine', 4);
      await report({ user: String(tlA._id), campaign_report: true }, adminA).expect(200);
    });

    it('nobody can name the superadmin to see another company', async () => {
      await fillPool(4, B, 7000);
      await service.create(ctxB(), { name: 'Theirs', staff: staffB.map((s) => String(s._id)), count: 4 });
      await report({ user: String(root._id), campaign_report: true, branch: String(B) }, adminA).expect(403);
    });
  });

  describe('edge cases', () => {
    it('no campaigns yet: an empty report, not an error', async () => {
      const res = await asAdminA().expect(200);
      expect(res.body).toEqual({ data: [], total: 0 });
    });

    it('a deleted campaign\'s lines drop out of the campaign report instead of showing a blank name', async () => {
      const c = await start('Gone', 4);
      await m.Campaign.deleteOne({ _id: c });
      const res = await asAdminA().expect(200);
      expect(res.body.total).toBe(0);
    });

    it('a closed campaign is still reported', async () => {
      const c = await start('Done', 4);
      await service.close(c, String(A));
      const res = await asAdminA().expect(200);
      expect(res.body.total).toBe(4);
    });

    it('a staff member who has left still has their lines reported', async () => {
      const c = await start('Left', 4);
      await m.User.deleteOne({ _id: staffA[0]._id });
      const res = await asAdminA().expect(200);
      expect(res.body.total).toBe(4);
      void c;
    });

    it('a 10,000 line report counts and pages quickly', async () => {
      const c = await start('Big', 1000, 4);
      const t = Date.now();
      const res = await asAdminA({ size: 50 }).expect(200);
      expect(res.body.total).toBe(1000);
      expect(Date.now() - t).toBeLessThan(3000);
      void c;
    });
  });
});
