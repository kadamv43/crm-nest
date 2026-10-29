import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { AttendanceModule } from './attendance.module';
import { AttendanceService } from './attendance.service';
import { attendanceDate } from 'src/common/time.util';

// Runs against a throwaway MongoDB. Set TEST_MONGO_URI; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

describeDb('GET /attendance', () => {
  let app: INestApplication;
  let server: any;
  let service: AttendanceService;
  let users: Model<any>;
  let branches: Model<any>;
  let attendance: Model<any>;

  const branchA = new Types.ObjectId();
  const branchB = new Types.ObjectId();
  const id = () => new Types.ObjectId();

  const people = {
    adminA: { userId: String(id()), role: 'admin', branch: String(branchA), username: 'adminA' },
    adminB: { userId: String(id()), role: 'admin', branch: String(branchB), username: 'adminB' },
    root: { userId: String(id()), role: 'superadmin', branch: String(branchA), username: 'root' },
    tl: { userId: String(id()), role: 'teamlead', branch: String(branchA), username: 'tl' },
    staff: { userId: String(id()), role: 'employee', branch: String(branchA), username: 'staff' },
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
  const get = (who: Who | null, url: string) => {
    const r = request(server).get(url);
    return who ? r.set('x-test-user', who) : r;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([
          { name: 'User', schema: new mongoose.Schema({ username: String, first_name: String, last_name: String, role: String, mobile: String }) },
          { name: 'Branch', schema: new mongoose.Schema({ name: String }) },
        ]),
        AttendanceModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    service = app.get(AttendanceService);
    users = app.get(getModelToken('User'));
    branches = app.get(getModelToken('Branch'));
    attendance = app.get(getModelToken('Attendance'));
    await attendance.init();
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await app?.close();
  }, 60000);

  const A1 = String(id()), A2 = String(id()), B1 = String(id());

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), branches.deleteMany({}), attendance.deleteMany({})]);
    await branches.insertMany([{ _id: branchA, name: 'Company A' }, { _id: branchB, name: 'Company B' }]);
    await users.insertMany([
      { _id: A1, username: 'asha', first_name: 'Asha', last_name: 'K', role: 'employee' },
      { _id: A2, username: 'ravi', first_name: 'Ravi', last_name: 'S', role: 'teamlead' },
      { _id: B1, username: 'meena', first_name: 'Meena', last_name: 'P', role: 'employee' },
    ]);
    await service.recordLogin(A2, String(branchA), ist('2025-03-10 08:20'));
    await service.recordLogin(A1, String(branchA), ist('2025-03-10 08:05'));
    await service.recordLogin(B1, String(branchB), ist('2025-03-10 08:40'));
    await service.recordLogin(A1, String(branchA), ist('2025-03-11 08:30'));
  });

  it('needs a login', async () => {
    await get(null, '/attendance').expect(401);
  });

  it('is not for team leads or staff', async () => {
    await get('tl', '/attendance?date=2025-03-10').expect(403);
    await get('staff', '/attendance?date=2025-03-10').expect(403);
  });

  it('an admin sees who logged in that day in their own company, earliest first', async () => {
    const res = await get('adminA', '/attendance?date=2025-03-10').expect(200);
    expect(res.body.date).toBe('2025-03-10');
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((r) => r.user.username)).toEqual(['asha', 'ravi']);
    expect(res.body.data[0]).toMatchObject({ date: '2025-03-10', login_count: 1 });
    expect(new Date(res.body.data[0].first_login_at).getTime()).toBe(ist('2025-03-10 08:05').getTime());
  });

  it('an admin can never see another company, even by asking for it', async () => {
    const res = await get('adminA', `/attendance?date=2025-03-10&branch=${branchB}`).expect(200);
    expect(res.body.data.map((r) => r.user.username)).toEqual(['asha', 'ravi']);
    const other = await get('adminB', '/attendance?date=2025-03-10').expect(200);
    expect(other.body.data.map((r) => r.user.username)).toEqual(['meena']);
  });

  it('superadmin sees every company, or one when asked', async () => {
    const all = await get('root', '/attendance?date=2025-03-10').expect(200);
    expect(all.body.total).toBe(3);
    const one = await get('root', `/attendance?date=2025-03-10&branch=${branchB}`).expect(200);
    expect(one.body.data.map((r) => r.user.username)).toEqual(['meena']);
    expect(one.body.data[0].branch.name).toBe('Company B');
  });

  it('shows only the asked day', async () => {
    const res = await get('adminA', '/attendance?date=2025-03-11').expect(200);
    expect(res.body.data.map((r) => r.user.username)).toEqual(['asha']);
  });

  it('a day nobody logged in is an empty list, not an error', async () => {
    const res = await get('adminA', '/attendance?date=2025-04-01').expect(200);
    expect(res.body).toEqual({ date: '2025-04-01', data: [], total: 0 });
  });

  it('without a date it is the current attendance day', async () => {
    const res = await get('adminA', '/attendance').expect(200);
    expect(res.body.date).toBe(attendanceDate());
    const blank = await get('adminA', '/attendance?date=').expect(200);
    expect(blank.body.date).toBe(attendanceDate());
  });

  it.each(['abc', '2025-13-01', '2025-02-30', '10-03-2025', '2025-3-1', "2025-03-10'; drop"])(
    'rejects the date %p',
    async (date) => {
      await get('adminA', `/attendance?date=${encodeURIComponent(date)}`).expect(400);
    },
  );
});
