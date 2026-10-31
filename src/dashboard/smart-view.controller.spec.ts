import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { BranchSchema } from 'src/branches/branch.schema';
import { UserSchema } from 'src/users/user.schema';
import { AttendanceService } from 'src/attendance/attendance.service';
import { DashboardModule } from './dashboard.module';

// Runs the smart view through the real controller and a throwaway MongoDB.
// Set TEST_MONGO_URI; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

describeDb('GET /dashboard/smart-view', () => {
  let app: INestApplication;
  let server: any;
  let m: Record<string, Model<any>>;
  let attendance: AttendanceService;

  const A = new Types.ObjectId();
  const B = new Types.ObjectId();
  const id = () => new Types.ObjectId();

  // everyone who exists
  const u = {
    adminA: { _id: id(), username: 'adminA', role: 'admin', branch: A },
    tlA: { _id: id(), username: 'tlA', role: 'teamlead', branch: A },
    tlA2: { _id: id(), username: 'tlA2', role: 'teamlead', branch: A },
    empA1: { _id: id(), username: 'empA1', role: 'employee', branch: A, teamlead: null as any },
    empA2: { _id: id(), username: 'empA2', role: 'employee', branch: A, teamlead: null as any },
    root: { _id: id(), username: 'root', role: 'superadmin', branch: A },
    adminB: { _id: id(), username: 'adminB', role: 'admin', branch: B },
    empB1: { _id: id(), username: 'empB1', role: 'employee', branch: B },
  };
  u.empA1.teamlead = u.tlA._id;
  u.empA2.teamlead = u.tlA2._id;
  type Who = keyof typeof u;

  const fakeGuard = {
    canActivate: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      const raw = req.headers['x-test-user'];
      if (!raw) throw new UnauthorizedException();
      const p = u[String(raw)];
      req.user = { userId: String(p._id), role: p.role, username: p.username, branch: { _id: String(p.branch) } };
      return true;
    },
  };

  const smart = (as: Who | null, query: string) => {
    const r = request(server).get('/dashboard/smart-view?' + query);
    return as ? r.set('x-test-user', as) : r;
  };
  const q = (user: Who, extra = '') => `user=${u[user]._id}&page=0&size=50${extra}`;
  const names = (res: any) => res.body.result.map((r: any) => r.userDetails.username);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([{ name: 'Branch', schema: BranchSchema }]),
        DashboardModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    attendance = app.get(AttendanceService);
    m = {
      activity: app.get(getModelToken('LeadActivity')),
      userLead: app.get(getModelToken('UserLead')),
      user: app.get(getModelToken('User')),
      branch: app.get(getModelToken('Branch')),
      attendance: app.get(getModelToken('Attendance')),
    };
    await Promise.all([m.activity.init(), m.attendance.init()]);
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await app?.close();
  }, 60000);

  // one lead for someone: handed out at `assignedAt`, then (optionally) worked
  async function lead(who: Who, assignedAt: Date, work?: [Date, string]) {
    const person = u[who];
    const _id = new Types.ObjectId();
    const contact = new Types.ObjectId();
    const base = { contact, branch: person.branch, user: person._id, source: 'LEAD', lead: _id };
    const events: any[] = [{ ...base, type: 'ASSIGNED', to_status: 'FRESH', created_at: assignedAt }];
    if (work) {
      events.push({ ...base, type: 'STATUS_UPDATE', from_status: 'FRESH', to_status: work[1], created_at: work[0] });
    }
    await m.activity.collection.insertMany(events);
    await m.userLead.collection.insertOne({
      _id, user: person._id, branch: person.branch, mobile: String(9000000000 + Math.floor(Math.random() * 1e8)),
      status: work ? work[1] : 'FRESH', created_at: assignedAt, updated_at: work ? work[0] : assignedAt,
    });
  }

  beforeEach(async () => {
    await Promise.all([m.activity.deleteMany({}), m.userLead.deleteMany({}), m.user.deleteMany({}), m.branch.deleteMany({}), m.attendance.deleteMany({})]);
    await m.branch.collection.insertMany([{ _id: A, name: 'Company A' }, { _id: B, name: 'Company B' }] as any);
    await m.user.collection.insertMany(Object.values(u) as any);
    const now = new Date();
    // today: empA1 has 1 fresh + 1 dead, empA2 has 1 fresh, empB1 has 1 dead
    await lead('empA1', now);
    await lead('empA1', now, [now, 'DEAD']);
    await lead('empA2', now);
    await lead('empB1', now, [now, 'DEAD']);
  });

  // ----------------------------------------------------------------- access
  describe('who can see what', () => {
    it('needs a login', async () => {
      await smart(null, q('adminA')).expect(401);
    });

    it('an admin sees their company, only people who have something to show', async () => {
      const res = await smart('adminA', q('adminA')).expect(200);
      expect(names(res)).toEqual(['empA1', 'empA2']);
      expect(res.body.total).toBe(2);
      const a1 = res.body.result.find((r: any) => r.userDetails.username === 'empA1');
      expect(a1.status).toMatchObject({ assigned: 2, fresh: 1, total_dialed: 1, dead: 1, total: 2 });
      expect(res.body.range.from).toBe(res.body.range.to);
    });

    it('an admin looking at one employee sees just that employee', async () => {
      const res = await smart('adminA', q('empA2')).expect(200);
      expect(names(res)).toEqual(['empA2']);
    });

    it('an admin cannot look at another company, or at the superadmin', async () => {
      await smart('adminA', q('empB1')).expect(403);
      await smart('adminA', q('adminB')).expect(403);
      await smart('adminA', q('root')).expect(403);
    });

    it('superadmin chooses a company', async () => {
      const a = await smart('root', q('root', `&branch=${A}`)).expect(200);
      expect(names(a)).toEqual(['empA1', 'empA2']);
      const b = await smart('root', q('root', `&branch=${B}`)).expect(200);
      expect(names(b)).toEqual(['empB1']);
    });

    it('superadmin must say which company', async () => {
      await smart('root', q('root')).expect(400);
      await smart('root', q('root', '&branch=not-an-id')).expect(400);
    });

    it('a team lead sees their team, not themselves and not other teams', async () => {
      const own = await smart('tlA', q('tlA')).expect(200);
      expect(names(own)).toEqual(['empA1']);
      const member = await smart('tlA', q('empA1')).expect(200);
      expect(names(member)).toEqual(['empA1']);
    });

    it('a team lead cannot look at another team, the admin or another company', async () => {
      await smart('tlA', q('empA2')).expect(403);
      await smart('tlA', q('tlA2')).expect(403);
      await smart('tlA', q('adminA')).expect(403);
      await smart('tlA', q('empB1')).expect(403);
    });

    it('staff see only themselves', async () => {
      const res = await smart('empA1', q('empA1')).expect(200);
      expect(names(res)).toEqual(['empA1']);
      await smart('empA1', q('empA2')).expect(403);
      await smart('empA1', q('tlA')).expect(403);
      await smart('empA1', q('adminA')).expect(403);
    });

    it('asking about nobody, or a person who does not exist, is refused politely', async () => {
      await smart('adminA', 'page=0&size=50').expect(400);
      await smart('adminA', 'user=not-an-id&page=0&size=50').expect(400);
      await smart('adminA', `user=${id()}&page=0&size=50`).expect(404);
    });
  });

  // ---------------------------------------------------------------- filters
  describe('filters are for admin and superadmin only', () => {
    const odd = '&from=2025-01-01&to=2025-01-02&q=zzz&logged_in=true';

    it('a team lead\'s filters are ignored: they still see today', async () => {
      const res = await smart('tlA', q('tlA', odd)).expect(200);
      expect(names(res)).toEqual(['empA1']);
    });

    it('staff filters are ignored too, even invalid ones', async () => {
      const res = await smart('empA1', q('empA1', '&from=bad&to=worse&q=zzz&logged_in=true')).expect(200);
      expect(names(res)).toEqual(['empA1']);
    });

    it('an admin\'s filters are applied', async () => {
      const res = await smart('adminA', q('adminA', odd)).expect(200);
      expect(res.body.result).toEqual([]);
      expect(res.body.range).toEqual({ from: '2025-01-01', to: '2025-01-02' });
    });

    it('username search', async () => {
      expect(names(await smart('adminA', q('adminA', '&q=A1')).expect(200))).toEqual(['empA1']);
      expect(names(await smart('adminA', q('adminA', '&q=EMP')).expect(200))).toEqual(['empA1', 'empA2']);
      expect(names(await smart('adminA', q('adminA', '&q=.*')).expect(200))).toEqual([]);
      expect(names(await smart('adminA', q('adminA', '&q=%28')).expect(200))).toEqual([]);
    });

    it('only logged in: people who logged in today, with zeros for those with no leads', async () => {
      await attendance.recordLogin(String(u.empA2._id), String(A), new Date());
      await attendance.recordLogin(String(u.tlA._id), String(A), new Date());
      const res = await smart('adminA', q('adminA', '&logged_in=true')).expect(200);
      expect(names(res)).toEqual(['empA2', 'tlA']); // empA1 has leads but did not log in
      const quiet = res.body.result.find((r: any) => r.userDetails.username === 'tlA');
      expect(quiet.status).toMatchObject({ total: 0, fresh: 0, total_dialed: 0 });
      expect(quiet.attendance.days_present).toBe(1);
      expect(res.body.result[0].attendance.first_login_at).toBeTruthy();
    });

    it('logged_in must be exactly "true"; anything else is the normal table', async () => {
      const res = await smart('adminA', q('adminA', '&logged_in=false')).expect(200);
      expect(names(res)).toEqual(['empA1', 'empA2']);
      const yes = await smart('adminA', q('adminA', '&logged_in=1')).expect(200);
      expect(names(yes)).toEqual(['empA1', 'empA2']);
    });

    it('a past day, from a past day\'s history', async () => {
      await lead('empA1', ist('2025-03-10 09:00'), [ist('2025-03-10 11:00'), 'RINGING']);
      await lead('empA1', ist('2025-03-10 09:00'));
      const res = await smart('adminA', q('adminA', '&from=2025-03-10&to=2025-03-10')).expect(200);
      const a1 = res.body.result.find((r: any) => r.userDetails.username === 'empA1');
      // as it was on that day: today's leads did not exist yet
      expect(a1.status).toMatchObject({ assigned: 2, total_dialed: 1, ringing: 1, fresh: 1, total: 2 });
      expect(a1.status.assigned).toBe(2);
      expect(a1.status.total_dialed).toBe(1);
      expect(a1.status.ringing).toBe(1);
    });

    it('only one end given means that single day', async () => {
      const from = await smart('adminA', q('adminA', '&from=2025-03-10')).expect(200);
      expect(from.body.range).toEqual({ from: '2025-03-10', to: '2025-03-10' });
      const to = await smart('adminA', q('adminA', '&to=2025-03-10')).expect(200);
      expect(to.body.range).toEqual({ from: '2025-03-10', to: '2025-03-10' });
    });

    it('superadmin has the same filters', async () => {
      await attendance.recordLogin(String(u.empB1._id), String(B), new Date());
      const res = await smart('root', q('root', `&branch=${B}&logged_in=true&q=empB`)).expect(200);
      expect(names(res)).toEqual(['empB1']);
    });
  });

  // ------------------------------------------------------------- validation
  describe('dates are checked', () => {
    it.each(['abc', '2025-13-01', '2025-02-30', '10-03-2025', '2025-3-1', ''])('rejects the date %p', async (bad) => {
      if (bad === '') return; // an empty value simply means "not given"
      await smart('adminA', q('adminA', `&from=${bad}&to=2025-03-10`)).expect(400);
      await smart('adminA', q('adminA', `&from=2025-03-10&to=${bad}`)).expect(400);
    });

    it('the start cannot be after the end', async () => {
      const res = await smart('adminA', q('adminA', '&from=2025-03-12&to=2025-03-10')).expect(400);
      expect(res.body.message).toContain('from must not be after to');
    });

    it('31 days is the most; 32 is refused', async () => {
      await smart('adminA', q('adminA', '&from=2025-03-01&to=2025-03-31')).expect(200); // exactly 31 days
      const res = await smart('adminA', q('adminA', '&from=2025-03-01&to=2025-04-01')).expect(400); // 32 days
      expect(res.body.message).toContain('31');
    });

    it('works across a leap day and a year end', async () => {
      await smart('adminA', q('adminA', '&from=2024-02-28&to=2024-03-01')).expect(200);
      await smart('adminA', q('adminA', '&from=2024-12-30&to=2025-01-02')).expect(200);
    });
  });

  describe('paging', () => {
    it('pages through people with the full total each time', async () => {
      const p0 = await smart('adminA', `user=${u.adminA._id}&page=0&size=1`).expect(200);
      const p1 = await smart('adminA', `user=${u.adminA._id}&page=1&size=1`).expect(200);
      const p2 = await smart('adminA', `user=${u.adminA._id}&page=2&size=1`).expect(200);
      expect(p0.body.total).toBe(2);
      expect(names(p0)).toEqual(['empA1']);
      expect(names(p1)).toEqual(['empA2']);
      expect(p2.body.result).toEqual([]);
    });
  });
});
