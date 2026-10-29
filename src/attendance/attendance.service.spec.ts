import mongoose, { Model, Types } from 'mongoose';
import { Attendance, AttendanceSchema } from './attendance.schema';
import { AttendanceService } from './attendance.service';

// Runs against a throwaway MongoDB. Set TEST_MONGO_URI, e.g.
// mongodb://127.0.0.1:27099/crm_attendance_test; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

// India time written the way people say it.
const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

describeDb('AttendanceService', () => {
  let conn: mongoose.Connection;
  let model: Model<Attendance>;
  let service: AttendanceService;

  const branchA = String(new Types.ObjectId());
  const branchB = String(new Types.ObjectId());
  const asha = String(new Types.ObjectId());
  const ravi = String(new Types.ObjectId());
  const meena = String(new Types.ObjectId());

  beforeAll(async () => {
    conn = await mongoose.createConnection(uri).asPromise();
    model = conn.model<Attendance>('Attendance', AttendanceSchema);
    conn.model('User', new mongoose.Schema({ username: String, first_name: String, last_name: String, role: String, mobile: String }));
    conn.model('Branch', new mongoose.Schema({ name: String }));
    await model.init();
    service = new AttendanceService(model as any);
  }, 60000);

  afterAll(async () => {
    await conn.dropDatabase();
    await conn.close();
  }, 60000);

  beforeEach(async () => {
    await model.deleteMany({});
  });

  describe('recordLogin', () => {
    it('the first login of the day creates the row and fixes the first-login time', async () => {
      const row = await service.recordLogin(asha, branchA, ist('2025-03-10 08:05'));
      expect(row.date).toBe('2025-03-10');
      expect(row.first_login_at).toEqual(ist('2025-03-10 08:05'));
      expect(row.last_login_at).toEqual(ist('2025-03-10 08:05'));
      expect(row.login_count).toBe(1);
      expect(String(row.branch)).toBe(branchA);
    });

    it('later logins the same day keep the first time and only raise the count', async () => {
      await service.recordLogin(asha, branchA, ist('2025-03-10 08:05'));
      await service.recordLogin(asha, branchA, ist('2025-03-10 13:40'));
      const row = await service.recordLogin(asha, branchA, ist('2025-03-10 18:00'));
      expect(row.first_login_at).toEqual(ist('2025-03-10 08:05'));
      expect(row.last_login_at).toEqual(ist('2025-03-10 18:00'));
      expect(row.login_count).toBe(3);
      expect(await model.countDocuments({ user: asha })).toBe(1);
    });

    it('a login out of order (an earlier time arriving late) still keeps the earliest first-login', async () => {
      await service.recordLogin(asha, branchA, ist('2025-03-10 10:00'));
      const row = await service.recordLogin(asha, branchA, ist('2025-03-10 08:30'));
      expect(row.first_login_at).toEqual(ist('2025-03-10 08:30'));
      expect(row.last_login_at).toEqual(ist('2025-03-10 10:00'));
    });

    it('the next day starts a new row only from 8 AM', async () => {
      await service.recordLogin(asha, branchA, ist('2025-03-10 08:05'));

      // late night and early morning belong to the same attendance day
      await service.recordLogin(asha, branchA, ist('2025-03-10 23:30'));
      await service.recordLogin(asha, branchA, ist('2025-03-11 02:00'));
      await service.recordLogin(asha, branchA, ist('2025-03-11 07:59'));
      expect(await model.countDocuments({ user: asha })).toBe(1);
      expect((await model.findOne({ user: asha })).login_count).toBe(4);

      // 8:00 AM begins the next day
      const next = await service.recordLogin(asha, branchA, ist('2025-03-11 08:00'));
      expect(next.date).toBe('2025-03-11');
      expect(next.first_login_at).toEqual(ist('2025-03-11 08:00'));
      expect(next.login_count).toBe(1);
      expect(await model.countDocuments({ user: asha })).toBe(2);
    });

    it('each person gets their own row', async () => {
      await service.recordLogin(asha, branchA, ist('2025-03-10 08:05'));
      await service.recordLogin(ravi, branchA, ist('2025-03-10 08:10'));
      await service.recordLogin(meena, branchB, ist('2025-03-10 09:00'));
      expect(await model.countDocuments({})).toBe(3);
    });

    it('many logins at the same moment make one row with the right count', async () => {
      const times = Array.from({ length: 25 }, (_, i) =>
        new Date(ist('2025-03-10 09:00').getTime() + i * 1000),
      );
      await Promise.all(times.map((t) => service.recordLogin(asha, branchA, t)));
      const rows = await model.find({ user: asha });
      expect(rows.length).toBe(1);
      expect(rows[0].login_count).toBe(25);
      expect(rows[0].first_login_at).toEqual(times[0]);
      expect(rows[0].last_login_at).toEqual(times[24]);
    });

    it('many different people logging in at once each get one row', async () => {
      const people = Array.from({ length: 60 }, () => String(new Types.ObjectId()));
      await Promise.all(
        people.map((p) => service.recordLogin(p, branchA, ist('2025-03-10 09:00'))),
      );
      expect(await model.countDocuments({ date: '2025-03-10' })).toBe(60);
    });

    it('the database itself refuses two rows for one person and day', async () => {
      await service.recordLogin(asha, branchA, ist('2025-03-10 09:00'));
      await expect(
        model.create({
          user: asha,
          branch: branchA,
          date: '2025-03-10',
          first_login_at: new Date(),
          last_login_at: new Date(),
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await conn.model('User').deleteMany({});
      await conn.model('Branch').deleteMany({});
      await conn.model('User').insertMany([
        { _id: asha, username: 'asha', first_name: 'Asha', last_name: 'K', role: 'employee', mobile: '9' },
        { _id: ravi, username: 'ravi', first_name: 'Ravi', last_name: 'S', role: 'teamlead', mobile: '8' },
        { _id: meena, username: 'meena', first_name: 'Meena', last_name: 'P', role: 'employee', mobile: '7' },
      ]);
      await conn.model('Branch').insertMany([
        { _id: branchA, name: 'Company A' },
        { _id: branchB, name: 'Company B' },
      ]);
      await service.recordLogin(ravi, branchA, ist('2025-03-10 08:20'));
      await service.recordLogin(asha, branchA, ist('2025-03-10 08:05'));
      await service.recordLogin(meena, branchB, ist('2025-03-10 08:40'));
      await service.recordLogin(asha, branchA, ist('2025-03-11 08:30'));
    });

    it('lists who logged in that day, earliest first, with names', async () => {
      const res = await service.list('2025-03-10', branchA);
      expect(res.date).toBe('2025-03-10');
      expect(res.total).toBe(2);
      expect(res.data.map((r: any) => r.user.username)).toEqual(['asha', 'ravi']);
      expect(res.data[0].user.first_name).toBe('Asha');
      expect(res.data[0].branch.name).toBe('Company A');
      expect(res.data[0].first_login_at).toEqual(ist('2025-03-10 08:05'));
    });

    it('only shows the requested company, or all when none is given', async () => {
      expect((await service.list('2025-03-10', branchB)).data.map((r: any) => r.user.username)).toEqual(['meena']);
      expect((await service.list('2025-03-10')).total).toBe(3);
    });

    it('only shows the requested day', async () => {
      const res = await service.list('2025-03-11', branchA);
      expect(res.data.map((r: any) => r.user.username)).toEqual(['asha']);
    });

    it('a day with no logins is empty', async () => {
      expect(await service.list('2025-03-12', branchA)).toEqual({ date: '2025-03-12', data: [], total: 0 });
    });

    it('loggedInUserIds returns who logged in that day, for the filters that come next', async () => {
      expect((await service.loggedInUserIds('2025-03-10', branchA)).sort()).toEqual([asha, ravi].sort());
      expect(await service.loggedInUserIds('2025-03-10', branchB)).toEqual([meena]);
      expect((await service.loggedInUserIds('2025-03-10')).length).toBe(3);
      expect(await service.loggedInUserIds('2025-03-20', branchA)).toEqual([]);
    });
  });
});
