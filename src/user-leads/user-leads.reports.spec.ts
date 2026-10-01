import mongoose, { Model, Types } from 'mongoose';
import { UserLead, UserLeadSchema } from './user-lead.schema';
import { User, UserSchema } from 'src/users/user.schema';
import { UserLeadsService } from './user-leads.service';

// Runs against a throwaway MongoDB. Set TEST_MONGO_URI (e.g.
// mongodb://127.0.0.1:27099/crm_report_test); the suite is skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

describeDb('UserLeadsService.getReports', () => {
  let conn: mongoose.Connection;
  let leadModel: Model<UserLead>;
  let userModel: Model<User>;
  let service: UserLeadsService;

  const branch = new Types.ObjectId();
  const tl = new Types.ObjectId();
  const emp1 = new Types.ObjectId();
  const emp2 = new Types.ObjectId();
  const deletedUser = new Types.ObjectId();

  const day = (s: string) => new Date(s);

  beforeAll(async () => {
    conn = await mongoose.createConnection(uri).asPromise();
    leadModel = conn.model<UserLead>('UserLead', UserLeadSchema);
    userModel = conn.model<User>('User', UserSchema);
    service = new UserLeadsService(leadModel as any);
  });

  afterAll(async () => {
    await conn.dropDatabase();
    await conn.close();
  });

  beforeEach(async () => {
    await leadModel.deleteMany({});
    await userModel.deleteMany({});
    await userModel.collection.insertMany([
      { _id: tl, username: 'tl', role: 'teamlead' },
      { _id: emp1, username: 'emp1', role: 'employee' },
      { _id: emp2, username: 'emp2', role: 'employee' },
    ] as any);

    const base = { branch };
    await leadModel.collection.insertMany([
      {
        ...base,
        mobile: '1',
        user: emp1,
        status: 'FRESH',
        is_hot_lead: false,
        created_at: day('2025-01-10T05:00:00Z'),
      },
      {
        ...base,
        mobile: '2',
        user: emp1,
        status: 'PAYMENT_DONE',
        is_hot_lead: true,
        created_at: day('2025-01-11T20:00:00Z'),
        payment: { payment_amount: '500', payment_mode: 'CASH' },
      },
      {
        ...base,
        mobile: '3',
        user: emp2,
        status: 'FRESH',
        // legacy document without the is_hot_lead flag
        created_at: day('2025-01-12T10:00:00Z'),
      },
      {
        ...base,
        mobile: '4',
        user: tl,
        status: 'FREE_TRIAL',
        is_hot_lead: false,
        created_at: day('2025-01-13T10:00:00Z'),
      },
      {
        ...base,
        mobile: '5',
        user: deletedUser,
        status: 'FRESH',
        is_hot_lead: false,
        created_at: day('2025-01-14T10:00:00Z'),
      },
    ] as any);
  });

  const mobiles = (res: any) => res.data.map((d: any) => d.mobile).sort();
  const ids = (...u: Types.ObjectId[]) => u.map((x) => x.toString());

  it('filters by a single user', async () => {
    const res = await service.getReports({ user: emp1.toString() });
    expect(mobiles(res)).toEqual(['1', '2']);
    expect(res.total).toBe(2);
  });

  it('filters by several users', async () => {
    const res = await service.getReports({ user: ids(emp1, emp2) });
    expect(mobiles(res)).toEqual(['1', '2', '3']);
  });

  it('filters by status', async () => {
    const res = await service.getReports({
      user: ids(emp1, emp2, tl),
      status: 'FRESH',
    });
    expect(mobiles(res)).toEqual(['1', '3']);
  });

  it('hot_lead returns only hot leads', async () => {
    const res = await service.getReports({
      user: ids(emp1, emp2, tl),
      lead_type: 'hot_lead',
    });
    expect(mobiles(res)).toEqual(['2']);
  });

  it('normal_lead includes leads missing the is_hot_lead flag', async () => {
    const res = await service.getReports({
      user: ids(emp1, emp2, tl),
      lead_type: 'normal_lead',
    });
    expect(mobiles(res)).toEqual(['1', '3', '4']);
  });

  it('from/to are inclusive and filter on created_at', async () => {
    const res = await service.getReports({
      user: ids(emp1, emp2, tl),
      from: '2025-01-11T00:00:00.000Z',
      to: '2025-01-12T23:59:59.999Z',
    });
    expect(mobiles(res)).toEqual(['2', '3']);
  });

  it('combines status, type and date filters', async () => {
    const res = await service.getReports({
      user: ids(emp1, emp2, tl),
      status: 'FRESH',
      lead_type: 'normal_lead',
      from: '2025-01-12T00:00:00.000Z',
      to: '2025-01-12T23:59:59.999Z',
    });
    expect(mobiles(res)).toEqual(['3']);
  });

  it('keeps leads whose user was deleted so data and total agree', async () => {
    const res = await service.getReports({
      user: ids(emp1, deletedUser),
    });
    expect(res.data.length).toBe(res.total);
    expect(mobiles(res)).toEqual(['1', '2', '5']);
  });

  it('paginates and reports the full total', async () => {
    const p0 = await service.getReports({
      user: ids(emp1, emp2, tl),
      page: 0,
      size: 2,
    });
    const p1 = await service.getReports({
      user: ids(emp1, emp2, tl),
      page: 1,
      size: 2,
    });
    expect(p0.data.length).toBe(2);
    expect(p1.data.length).toBe(2);
    expect(p0.total).toBe(4);
    // newest first, no overlap between pages
    expect(p0.data[0].mobile).toBe('4');
    const all = [...p0.data, ...p1.data].map((d: any) => d.mobile);
    expect(new Set(all).size).toBe(4);
  });

  it('excel mode returns every matching row, ignoring pagination', async () => {
    const res = await service.getReports({
      user: ids(emp1, emp2, tl),
      page: 0,
      size: 1,
      excel: true,
    });
    expect(res.data.length).toBe(4);
    expect(res.total).toBe(4);
  });

  it('returns nested payment fields and the username for each row', async () => {
    const res = await service.getReports({ user: emp1.toString() });
    const paid = res.data.find((d: any) => d.mobile === '2');
    expect(paid.payment.payment_mode).toBe('CASH');
    expect(paid.userDetails.username).toBe('emp1');
  });
});
