import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import mongoose, { Model, Types } from 'mongoose';
import * as request from 'supertest';
import * as XLSX from 'xlsx';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { ContactsModule } from './contacts.module';
import { LeadsModule } from 'src/leads/leads.module';
import { HotLeadsModule } from 'src/hot-leads/hot-leads.module';
import { UserLeadsModule } from 'src/user-leads/user-leads.module';
import { UserHotLeadsModule } from 'src/user-hot-leads/user-hot-leads.module';
import { UserSchema } from 'src/users/user.schema';
import { BranchSchema } from 'src/branches/branch.schema';

// Runs the daily flow through the real controllers and services against a
// throwaway MongoDB. Set TEST_MONGO_URI, e.g.
// mongodb://127.0.0.1:27099/crm_flow_test; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

describeDb('Daily lead flow (contacts)', () => {
  let app: INestApplication;
  let server: any;
  let m: Record<string, Model<any>>;

  const branchA = new Types.ObjectId();
  const branchB = new Types.ObjectId();
  const id = () => new Types.ObjectId();

  const people = {
    adminA: { userId: String(id()), role: 'admin', branch: String(branchA), username: 'adminA' },
    tlA: { userId: String(id()), role: 'teamlead', branch: String(branchA), username: 'tlA' },
    staff1: { userId: String(id()), role: 'employee', branch: String(branchA), username: 'staff1' },
    staff2: { userId: String(id()), role: 'employee', branch: String(branchA), username: 'staff2' },
    adminB: { userId: String(id()), role: 'admin', branch: String(branchB), username: 'adminB' },
    superadmin: { userId: String(id()), role: 'superadmin', branch: String(branchA), username: 'root' },
  };
  type Who = keyof typeof people;

  // The real JwtAuthGuard needs a signed token; here the request carries the
  // already-verified user, which is exactly what the guard hands to controllers.
  const fakeGuard = {
    canActivate: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      const raw = req.headers['x-test-user'];
      if (!raw) {
        throw new UnauthorizedException();
      }
      const p = people[String(raw)];
      req.user = { ...p, branch: { _id: p.branch } };
      return true;
    },
  };

  const as = (who: Who, r: request.Test) => r.set('x-test-user', who);
  const get = (who: Who, url: string) => as(who, request(server).get(url));
  const post = (who: Who, url: string, body?: any) =>
    as(who, request(server).post(url)).send(body);
  const put = (who: Who, url: string, body?: any) =>
    as(who, request(server).put(url)).send(body);

  const sheet = (rows: any[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const upload = (who: Who, url: string, buf: Buffer) =>
    as(who, request(server).post(url)).attach('file', buf, 'leads.xlsx');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([
          { name: 'User', schema: UserSchema },
          { name: 'Branch', schema: BranchSchema },
        ]),
        ContactsModule,
        LeadsModule,
        HotLeadsModule,
        UserLeadsModule,
        UserHotLeadsModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeGuard)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    m = {
      contact: app.get(getModelToken('Contact')),
      activity: app.get(getModelToken('LeadActivity')),
      lead: app.get(getModelToken('Lead')),
      hot: app.get(getModelToken('HotLead')),
      userLead: app.get(getModelToken('UserLead')),
      userHot: app.get(getModelToken('UserHotLead')),
      user: app.get(getModelToken('User')),
      branch: app.get(getModelToken('Branch')),
    };
    await Promise.all(Object.values(m).map((model) => model.init()));
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await app?.close();
  }, 60000);

  beforeEach(async () => {
    await Promise.all(Object.values(m).map((model) => model.deleteMany({})));
    await m.branch.collection.insertMany([
      { _id: branchA, name: 'Company A' },
      { _id: branchB, name: 'Company B' },
    ] as any);
    await m.user.collection.insertMany(
      Object.entries(people).map(([name, p]) => ({
        _id: new Types.ObjectId(p.userId),
        username: name,
        role: p.role,
      })) as any,
    );
  });

  const contactsOf = (branch: Types.ObjectId) =>
    m.contact.countDocuments({ branch });

  // ---------------------------------------------------------------- security
  describe('login and company scope', () => {
    it('the lead endpoints now require login', async () => {
      await request(server).get('/leads').expect(401);
      await request(server).post('/leads').send({ mobile: '9000000001' }).expect(401);
      await request(server).get('/hot-leads').expect(401);
      await request(server).post('/hot-leads').send({}).expect(401);
      await request(server).get('/contacts/stats').expect(401);
    });
  });

  // ------------------------------------------------------------ daily upload
  describe('daily upload to the pool (Excel)', () => {
    const day1 = [
      ['mobile', 'name', 'city'],
      ['9000000001', 'Asha', 'Pune'],
      ['9000000002', 'Ravi', 'Delhi'],
      ['+91 90000 00003', 'Meena', 'Goa'],
      ['9000000001', 'Asha again', 'Pune'], // repeated in the file
      ['09000000002', '', ''], // same number typed differently
      ['abc', 'Bad', ''], // invalid
      ['', 'No number', ''], // blank
      [9000000004, 'Numeric cell', 'Agra'], // Excel number cell
    ];

    it('removes repeats inside the file, skips invalid rows and reports it', async () => {
      const res = await upload('adminA', '/leads/import-excel', sheet(day1)).expect(201);

      expect(res.body).toMatchObject({
        total_in_file: 8,
        duplicates_in_file: 2,
        invalid: 2,
        new_contacts: 4,
        existing_contacts: 0,
        already_in_pool: 0,
        added: 4,
      });
      expect(res.body.message).toContain('4 added');
      expect(await contactsOf(branchA)).toBe(4);
      expect(await m.lead.countDocuments({ branch: branchA })).toBe(4);
    });

    it('every pool row points at its contact and keeps who uploaded it', async () => {
      await upload('adminA', '/leads/import-excel', sheet(day1)).expect(201);
      const rows = await m.lead.find({ branch: branchA }).lean<any>();
      for (const row of rows) {
        const contact = await m.contact.findById(row.contact).lean<any>();
        expect(contact).toBeTruthy();
        expect(contact.mobile).toBe(row.mobile);
        expect(String(row.uploaded_by)).toBe(people.adminA.userId);
      }
      expect((await m.contact.findOne({ mobile: '9000000001' })).name).toBe('Asha');
    });

    it('accepts header names in any case', async () => {
      const res = await upload(
        'adminA',
        '/leads/import-excel',
        sheet([['Mobile', ' NAME ', 'City'], ['9000000001', 'A', 'B']]),
      ).expect(201);
      expect(res.body.added).toBe(1);
    });

    it('a team lead can upload too and lands in the same company pool', async () => {
      await upload('tlA', '/leads/import-excel', sheet(day1)).expect(201);
      const list = await get('adminA', '/leads?page=0&size=50').expect(200);
      expect(list.body.total).toBe(4);
    });

    it('rejects a missing or unreadable file', async () => {
      await as('adminA', request(server).post('/leads/import-excel')).expect(400);
      await upload('adminA', '/leads/import-excel', Buffer.from('not an excel file')).expect(400);
    });

    it('rejects a sheet that has no mobile column', async () => {
      const res = await upload(
        'adminA',
        '/leads/import-excel',
        sheet([['phone', 'name'], ['9000000001', 'A']]),
      ).expect(400);
      expect(res.body.message).toContain('mobile');
      expect(await contactsOf(branchA)).toBe(0);
    });

    it('an empty sheet adds nothing', async () => {
      const res = await upload('adminA', '/leads/import-excel', sheet([['mobile']])).expect(201);
      expect(res.body.added).toBe(0);
      expect(await contactsOf(branchA)).toBe(0);
    });
  });

  describe('daily upload to the pool (paste box)', () => {
    it('adds the numbers, one per line, ignoring blank lines and repeats', async () => {
      const res = await post('adminA', '/leads', {
        mobile: '9000000001\n\n 9000000002 \r\n9000000001\nxyz',
      }).expect(201);
      expect(res.body).toMatchObject({
        added: 2,
        duplicates_in_file: 1,
        invalid: 1,
        new_contacts: 2,
      });
    });
  });

  // ----------------------------------------- same number on a later day
  describe('the same number uploaded again', () => {
    const numbers = ['9000000001', '9000000002', '9000000003'];

    async function assignAll(to: Who) {
      const pool = await get('adminA', '/leads?page=0&size=100').expect(200);
      await post('adminA', '/user-leads/bulk', {
        user: people[to].userId,
        leads: pool.body.data,
      }).expect(201);
    }

    it('while still waiting in the pool it is not added twice', async () => {
      await post('adminA', '/leads', { mobile: numbers.join('\n') }).expect(201);
      const again = await post('adminA', '/leads', { mobile: numbers.join('\n') }).expect(201);

      expect(again.body).toMatchObject({
        added: 0,
        already_in_pool: 3,
        new_contacts: 0,
        existing_contacts: 3,
      });
      expect(await m.lead.countDocuments({ branch: branchA })).toBe(3);
      expect(await contactsOf(branchA)).toBe(3);
    });

    it('after it was called, a new daily row reuses the old contact', async () => {
      await post('adminA', '/leads', { mobile: numbers.join('\n') }).expect(201);
      const contactIds = (await m.contact.find({ branch: branchA }).lean<any>()).map((c) => String(c._id)).sort();
      await assignAll('staff1'); // day 1: handed out, pool emptied
      expect(await m.lead.countDocuments({ branch: branchA })).toBe(0);

      // day 2: the same numbers plus one new one
      const day2 = await post('adminA', '/leads', {
        mobile: [...numbers, '9000000009'].join('\n'),
      }).expect(201);

      expect(day2.body).toMatchObject({ added: 4, new_contacts: 1, existing_contacts: 3 });
      expect(await contactsOf(branchA)).toBe(4);

      const reused = (await m.lead.find({ mobile: { $in: numbers } }).lean<any>()).map((l) => String(l.contact)).sort();
      expect(reused).toEqual(contactIds);
    });

    it('handing out the second day creates new calling rows on the same contacts', async () => {
      await post('adminA', '/leads', { mobile: numbers.join('\n') }).expect(201);
      await assignAll('staff1');
      await post('adminA', '/leads', { mobile: numbers.join('\n') }).expect(201);
      await assignAll('staff2');

      expect(await contactsOf(branchA)).toBe(3);
      expect(await m.userLead.countDocuments({ branch: branchA })).toBe(6);
      for (const mobile of numbers) {
        const rows = await m.userLead.find({ mobile }).lean<any>();
        expect(rows.length).toBe(2);
        expect(String(rows[0].contact)).toBe(String(rows[1].contact));
        expect(rows.map((r) => String(r.user)).sort()).toEqual(
          [people.staff1.userId, people.staff2.userId].sort(),
        );
      }
    });

    it('total unique leads stays at the number of different numbers', async () => {
      await post('adminA', '/leads', { mobile: numbers.join('\n') }).expect(201);
      await assignAll('staff1');
      await post('adminA', '/leads', { mobile: numbers.join('\n') }).expect(201);
      await assignAll('staff2');
      const stats = await get('adminA', '/contacts/stats').expect(200);
      expect(stats.body.total_unique_leads).toBe(3);
    });
  });

  // ---------------------------------------------------------- hand out
  describe('handing leads to staff', () => {
    it('moves pool rows to the staff member with contact and mobile, and empties the pool', async () => {
      await post('adminA', '/leads', { mobile: '9000000001\n9000000002' }).expect(201);
      const pool = await get('adminA', '/leads?page=0&size=10').expect(200);
      await post('adminA', '/user-leads/bulk', {
        user: people.staff1.userId,
        leads: pool.body.data,
      }).expect(201);

      const rows = await m.userLead.find({}).lean<any>();
      expect(rows.length).toBe(2);
      for (const r of rows) {
        expect(r.contact).toBeTruthy();
        expect(r.mobile).toMatch(/^\d{10}$/);
        expect(String(r.user)).toBe(people.staff1.userId);
        expect(String(r.branch)).toBe(String(branchA));
        expect(r.status).toBe('FRESH');
        expect(r.assigned_by).toBe('adminA');
      }
      expect(await m.lead.countDocuments({})).toBe(0);
    });

    it('writes one ASSIGNED activity per row', async () => {
      await post('adminA', '/leads', { mobile: '9000000001\n9000000002' }).expect(201);
      const pool = await get('adminA', '/leads?page=0&size=10');
      await post('tlA', '/user-leads/bulk', { user: people.staff1.userId, leads: pool.body.data }).expect(201);

      const acts = await m.activity.find({ type: 'ASSIGNED' }).lean<any>();
      expect(acts.length).toBe(2);
      acts.forEach((a) => {
        expect(String(a.user)).toBe(people.staff1.userId);
        expect(String(a.actor)).toBe(people.tlA.userId);
        expect(a.source).toBe('LEAD');
        expect(a.to_status).toBe('FRESH');
      });
    });

    it('only the chosen pool rows are removed', async () => {
      await post('adminA', '/leads', { mobile: '9000000001\n9000000002\n9000000003' }).expect(201);
      const pool = await get('adminA', '/leads?page=0&size=10');
      await post('adminA', '/user-leads/bulk', {
        user: people.staff1.userId,
        leads: pool.body.data.slice(0, 1),
      }).expect(201);
      expect(await m.lead.countDocuments({})).toBe(2);
    });

    it('paste-assign to one staff member: repeats removed, invalid reported, contacts reused', async () => {
      await post('adminA', '/leads', { mobile: '9000000001' }).expect(201); // known already
      const res = await post('adminA', '/user-leads', {
        user: people.staff1.userId,
        mobile: '9000000001\n9000000002\n9000000002\nbad\n',
      }).expect(201);

      expect(res.body).toMatchObject({
        assigned: 2,
        duplicates_in_file: 1,
        invalid: 1,
        new_contacts: 1,
        existing_contacts: 1,
      });
      expect(await contactsOf(branchA)).toBe(2);
      expect(await m.userLead.countDocuments({})).toBe(2);
      expect(await m.activity.countDocuments({ type: 'ASSIGNED' })).toBe(2);
    });

    it('paste-assign needs a staff member', async () => {
      await post('adminA', '/user-leads', { mobile: '9000000001' }).expect(400);
    });

    it('assigning a number that is already with someone else is allowed (re-work)', async () => {
      await post('adminA', '/user-leads', { user: people.staff1.userId, mobile: '9000000001' }).expect(201);
      await post('adminA', '/user-leads', { user: people.staff2.userId, mobile: '9000000001' }).expect(201);
      expect(await contactsOf(branchA)).toBe(1);
      expect(await m.userLead.countDocuments({ mobile: '9000000001' })).toBe(2);
    });

    it('an invalid mobile in a bulk assignment is an error, not a silent drop', async () => {
      await post('adminA', '/user-leads/bulk', {
        user: people.staff1.userId,
        leads: [{ mobile: '9000000001' }, { mobile: 'nope' }],
      }).expect(400);
      expect(await m.userLead.countDocuments({})).toBe(0);
    });

    it('a repeat payment ("invest more") is another row on the same contact', async () => {
      await post('adminA', '/user-leads', { user: people.staff1.userId, mobile: '9000000001' }).expect(201);
      const first = await m.userLead.findOne({}).lean<any>();

      await post('staff1', '/user-leads/bulk', {
        user: people.staff1.userId,
        leads: [
          {
            mobile: first.mobile,
            city: 'Pune',
            status: 'PAYMENT_DONE',
            payment: { payment_amount: '5000', payment_mode: 'UPI', payment_date: '2025-02-01' },
          },
        ],
      }).expect(201);

      expect(await contactsOf(branchA)).toBe(1);
      const rows = await m.userLead.find({}).sort({ created_at: 1 }).lean<any>();
      expect(rows.length).toBe(2);
      expect(String(rows[1].contact)).toBe(String(first.contact));
      expect(rows[1].status).toBe('PAYMENT_DONE');
      expect(rows[1].payment.payment_amount).toBe('5000');
    });

    it('hot leads: one number is one contact whether it is a normal or a hot lead', async () => {
      await post('adminA', '/leads', { mobile: '9000000001' }).expect(201);
      const hot = await post('adminA', '/hot-leads', {
        mobile: '9000000001',
        name: 'Hot Person',
        city: 'Pune',
        investment: '100000',
      }).expect(201);

      expect(hot.body).toMatchObject({ added: 1, new_contacts: 0, existing_contacts: 1 });
      expect(await contactsOf(branchA)).toBe(1);
      const lead = await m.lead.findOne({}).lean<any>();
      const hotRow = await m.hot.findOne({}).lean<any>();
      expect(String(hotRow.contact)).toBe(String(lead.contact));
      expect(hotRow.investment).toBe('100000');
    });

    it('hot lead entered twice is skipped the second time', async () => {
      await post('adminA', '/hot-leads', { mobile: '9000000001' }).expect(201);
      const again = await post('adminA', '/hot-leads', { mobile: '+91 9000000001' }).expect(201);
      expect(again.body).toMatchObject({ added: 0, already_in_pool: 1 });
    });

    it('hot leads: Excel upload, hand out through user-hot-leads, and activity is HOT_LEAD', async () => {
      const up = await upload(
        'adminA',
        '/hot-leads/import-excel',
        sheet([['mobile', 'name', 'city', 'investment'], ['9000000001', 'H1', 'X', '5000'], ['9000000002', 'H2', 'Y', '7000']]),
      ).expect(201);
      expect(up.body.added).toBe(2);

      const pool = await get('adminA', '/hot-leads?page=0&size=10').expect(200);
      expect(pool.body.total).toBe(2);
      await post('adminA', '/user-hot-leads/bulk', { user: people.staff1.userId, leads: pool.body.data }).expect(201);

      expect(await m.userHot.countDocuments({})).toBe(2);
      expect(await m.hot.countDocuments({})).toBe(0);
      const rows = await m.userHot.find({}).lean<any>();
      rows.forEach((r) => expect(r.contact).toBeTruthy());
      expect(await m.activity.countDocuments({ source: 'HOT_LEAD', type: 'ASSIGNED' })).toBe(2);
    });

    it('hot leads paste-assign works the same way', async () => {
      const res = await post('adminA', '/user-hot-leads', {
        user: people.staff1.userId,
        mobile: '9000000001\n9000000001',
      }).expect(201);
      expect(res.body).toMatchObject({ assigned: 1, duplicates_in_file: 1 });
    });
  });

  // ------------------------------------------------- who called whom
  describe('who called whom, and how many times', () => {
    async function leadFor(who: Who, mobile = '9000000001') {
      await post('adminA', '/user-leads', { user: people[who].userId, mobile }).expect(201);
      return m.userLead.findOne({ mobile, user: people[who].userId }).sort({ created_at: -1 }).lean<any>();
    }

    it('records a status update with from and to, and who made it', async () => {
      const lead = await leadFor('staff1');
      await put('staff1', `/user-leads/${lead._id}`, { status: 'RINGING' }).expect(200);
      await put('staff1', `/user-leads/${lead._id}`, { status: 'CALLBACK' }).expect(200);

      const acts = await m.activity.find({ type: 'STATUS_UPDATE' }).sort({ created_at: 1 }).lean<any>();
      expect(acts.map((a) => [a.from_status, a.to_status])).toEqual([
        ['FRESH', 'RINGING'],
        ['RINGING', 'CALLBACK'],
      ]);
      acts.forEach((a) => {
        expect(String(a.user)).toBe(people.staff1.userId);
        expect(String(a.actor)).toBe(people.staff1.userId);
        expect(String(a.contact)).toBe(String(lead.contact));
      });
    });

    it('updating other fields (not the status) is not counted as a call', async () => {
      const lead = await leadFor('staff1');
      await put('staff1', `/user-leads/${lead._id}`, { name: 'Renamed', city: 'Pune' }).expect(200);
      expect(await m.activity.countDocuments({ type: 'STATUS_UPDATE' })).toBe(0);
      expect((await m.userLead.findById(lead._id)).name).toBe('Renamed');
    });

    it('setting the same status again still counts as working the lead', async () => {
      const lead = await leadFor('staff1');
      await put('staff1', `/user-leads/${lead._id}`, { status: 'RINGING' }).expect(200);
      await put('staff1', `/user-leads/${lead._id}`, { status: 'RINGING' }).expect(200);
      expect(await m.activity.countDocuments({ type: 'STATUS_UPDATE' })).toBe(2);
    });

    it('the number and company of a lead cannot be changed by an update', async () => {
      const lead = await leadFor('staff1');
      await put('staff1', `/user-leads/${lead._id}`, {
        status: 'DEAD',
        mobile: '9111111111',
        contact: String(id()),
        branch: String(branchB),
      }).expect(200);
      const after = await m.userLead.findById(lead._id).lean<any>();
      expect(after.mobile).toBe('9000000001');
      expect(String(after.contact)).toBe(String(lead.contact));
      expect(String(after.branch)).toBe(String(branchA));
      expect(after.status).toBe('DEAD');
    });

    it('nested payment / free trial updates still work and are logged by their status', async () => {
      const lead = await leadFor('staff1');
      await put('staff1', `/user-leads/${lead._id}`, {
        status: 'FREE_TRIAL',
        free_trial: { free_trial_date: '2025-03-01', investment: '1000' },
      }).expect(200);
      const after = await m.userLead.findById(lead._id).lean<any>();
      expect(after.free_trial.investment).toBe('1000');
      expect(after.free_trial.free_trial_date).toBeInstanceOf(Date);
      expect(await m.activity.countDocuments({ to_status: 'FREE_TRIAL' })).toBe(1);
    });

    it('hot lead status updates are logged as HOT_LEAD', async () => {
      await post('adminA', '/user-hot-leads', { user: people.staff1.userId, mobile: '9000000001' }).expect(201);
      const row = await m.userHot.findOne({}).lean<any>();
      await put('staff1', `/user-hot-leads/${row._id}`, { status: 'RINGING', mobile: '9222222222' }).expect(200);
      const act = await m.activity.findOne({ type: 'STATUS_UPDATE' }).lean<any>();
      expect(act.source).toBe('HOT_LEAD');
      expect((await m.userHot.findById(row._id)).mobile).toBe('9000000001');
    });

    it('lookup shows the contact, how often it was handed out and worked, and by whom', async () => {
      const a = await leadFor('staff1');
      await put('staff1', `/user-leads/${a._id}`, { status: 'RINGING' }).expect(200);
      await put('staff1', `/user-leads/${a._id}`, { status: 'DEAD' }).expect(200);
      const b = await leadFor('staff2');
      await put('staff2', `/user-leads/${b._id}`, { status: 'FREE_TRIAL' }).expect(200);

      const res = await get('adminA', '/contacts/lookup?mobile=%2B91%209000000001').expect(200);
      expect(res.body.length).toBe(1);
      const [found] = res.body;
      expect(found.contact.mobile).toBe('9000000001');
      expect(found.summary).toMatchObject({
        times_assigned: 2,
        times_worked: 3,
        last_status: 'FREE_TRIAL',
      });
      expect(found.summary.last_worked_by.username).toBe('staff2');
      expect(found.activity.length).toBe(5);
    });

    it('activity history of a contact is paged, newest first', async () => {
      const a = await leadFor('staff1');
      for (const s of ['RINGING', 'CALLBACK', 'DEAD']) {
        await put('staff1', `/user-leads/${a._id}`, { status: s }).expect(200);
      }
      const contact = await m.contact.findOne({}).lean<any>();
      const page1 = await get('adminA', `/contacts/${contact._id}/activity?page=0&size=3`).expect(200);
      expect(page1.body.total).toBe(4);
      expect(page1.body.data.length).toBe(3);
      expect(page1.body.data[0].to_status).toBe('DEAD');
      const page2 = await get('adminA', `/contacts/${contact._id}/activity?page=1&size=3`).expect(200);
      expect(page2.body.data.length).toBe(1);
      expect(page2.body.data[0].type).toBe('ASSIGNED');
    });

    it('lookup rejects blank and invalid numbers and returns nothing for unknown ones', async () => {
      await get('adminA', '/contacts/lookup').expect(400);
      await get('adminA', '/contacts/lookup?mobile=abc').expect(400);
      const none = await get('adminA', '/contacts/lookup?mobile=9999999999').expect(200);
      expect(none.body).toEqual([]);
    });
  });

  // ------------------------------------------------------- lead history
  describe('lead history (mobile search)', () => {
    it('lists every row of the number whatever the spelling, newest first', async () => {
      await post('adminA', '/user-leads', { user: people.staff1.userId, mobile: '9000000001' }).expect(201);
      await post('adminA', '/user-leads', { user: people.staff2.userId, mobile: '9000000001' }).expect(201);
      await post('adminA', '/user-leads', { user: people.staff2.userId, mobile: '9000000002' }).expect(201);

      const res = await get('adminA', '/user-leads/get-lead-history?mobile=9000000001&page=0&size=10').expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].user.username).toBe('staff2'); // newest first, user populated
      res.body.data.forEach((r) => expect(r.mobile).toBe('9000000001'));
    });

    it('pages the history', async () => {
      for (let i = 0; i < 3; i++) {
        await post('adminA', '/user-leads', { user: people.staff1.userId, mobile: '9000000001' }).expect(201);
      }
      const res = await get('adminA', '/user-leads/get-lead-history?mobile=9000000001&page=1&size=2').expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.data.length).toBe(1);
    });

    it('validates the number', async () => {
      await get('adminA', '/user-leads/get-lead-history?mobile=&page=0&size=10').expect(400);
      await get('adminA', '/user-leads/get-lead-history?mobile=12345&page=0&size=10').expect(400);
      await get('adminA', '/user-leads/get-lead-history?page=0&size=10').expect(400);
    });

    it('an unknown number has an empty history', async () => {
      const res = await get('adminA', '/user-leads/get-lead-history?mobile=9999999999&page=0&size=10').expect(200);
      expect(res.body).toEqual({ data: [], total: 0 });
    });

    it('never shows another company\'s history', async () => {
      await post('adminA', '/user-leads', { user: people.staff1.userId, mobile: '9000000001' }).expect(201);
      const b = await get('adminB', '/user-leads/get-lead-history?mobile=9000000001&page=0&size=10').expect(200);
      expect(b.body.total).toBe(0);
    });
  });

  // ----------------------------------------------------- pool management
  describe('pool list and edit', () => {
    beforeEach(async () => {
      await post('adminA', '/leads', { mobile: '9000000001\n9000000002\n9000000003' }).expect(201);
    });

    it('lists the pool with mobile, paged, and searchable', async () => {
      const all = await get('adminA', '/leads?page=0&size=2').expect(200);
      expect(all.body.total).toBe(3);
      expect(all.body.data.length).toBe(2);
      expect(all.body.data[0].mobile).toMatch(/^\d{10}$/);

      const search = await get('adminA', '/leads?page=0&size=10&q=0002').expect(200);
      expect(search.body.total).toBe(1);
      expect(search.body.data[0].mobile).toBe('9000000002');
    });

    it('search text is matched literally, not as a pattern', async () => {
      const res = await get('adminA', '/leads?page=0&size=10&q=.*').expect(200);
      expect(res.body.total).toBe(0);
    });

    it('changing the number moves the row to that number\'s contact', async () => {
      const row = await m.lead.findOne({ mobile: '9000000001' }).lean<any>();
      const res = await put('adminA', `/leads/${row._id}`, { mobile: '+91 98765 43210', name: 'Changed' }).expect(200);

      expect(res.body.mobile).toBe('9876543210');
      expect(res.body.name).toBe('Changed');
      const contact = await m.contact.findOne({ mobile: '9876543210' }).lean<any>();
      expect(String(res.body.contact)).toBe(String(contact._id));
      expect(await contactsOf(branchA)).toBe(4);
    });

    it('refuses to move a row onto a number already waiting in the pool', async () => {
      const row = await m.lead.findOne({ mobile: '9000000001' }).lean<any>();
      await put('adminA', `/leads/${row._id}`, { mobile: '9000000002' }).expect(409);
      expect((await m.lead.findById(row._id)).mobile).toBe('9000000001');
    });

    it('refuses an invalid number', async () => {
      const row = await m.lead.findOne({}).lean<any>();
      await put('adminA', `/leads/${row._id}`, { mobile: 'abc' }).expect(400);
    });

    it('editing other fields keeps the contact', async () => {
      const row = await m.lead.findOne({}).lean<any>();
      const res = await put('adminA', `/leads/${row._id}`, { name: 'Only a name', contact: String(id()), branch: String(branchB) }).expect(200);
      expect(String(res.body.contact)).toBe(String(row.contact));
      expect(String(res.body.branch)).toBe(String(branchA));
    });

    it('deletes a row', async () => {
      const row = await m.lead.findOne({}).lean<any>();
      await as('adminA', request(server).delete(`/leads/${row._id}`)).expect(200);
      expect(await m.lead.countDocuments({})).toBe(2);
      await as('adminA', request(server).delete(`/leads/${row._id}`)).expect(404);
    });

    it('hot-lead bulk delete removes only the chosen rows', async () => {
      await post('adminA', '/hot-leads', { mobile: '9000000001' }).expect(201);
      await post('adminA', '/hot-leads', { mobile: '9000000002' }).expect(201);
      const rows = await m.hot.find({}).lean<any>();
      await post('adminA', '/hot-leads/delete-bulk', { leads: [{ _id: String(rows[0]._id) }] }).expect(201);
      expect(await m.hot.countDocuments({})).toBe(1);
    });
  });

  // ------------------------------------------------------- companies
  describe('companies are kept apart', () => {
    it('the same numbers in two companies are two contacts each, with separate pools', async () => {
      await post('adminA', '/leads', { mobile: '9000000001\n9000000002' }).expect(201);
      const b = await post('adminB', '/leads', { mobile: '9000000001\n9000000003' }).expect(201);
      expect(b.body).toMatchObject({ added: 2, new_contacts: 2, existing_contacts: 0 });

      expect(await contactsOf(branchA)).toBe(2);
      expect(await contactsOf(branchB)).toBe(2);
      expect((await get('adminA', '/leads?page=0&size=10')).body.total).toBe(2);
      expect((await get('adminB', '/leads?page=0&size=10')).body.total).toBe(2);
    });

    it('a company cannot read, edit or delete another company\'s pool rows', async () => {
      await post('adminA', '/leads', { mobile: '9000000001' }).expect(201);
      const row = await m.lead.findOne({}).lean<any>();

      await get('adminB', `/leads/${row._id}`).expect(404);
      await put('adminB', `/leads/${row._id}`, { name: 'hijack' }).expect(404);
      await as('adminB', request(server).delete(`/leads/${row._id}`)).expect(404);
      expect((await m.lead.findById(row._id)).name).toBeUndefined();
    });

    it('handing out cannot delete another company\'s pool rows', async () => {
      await post('adminA', '/leads', { mobile: '9000000001' }).expect(201);
      const row = await m.lead.findOne({}).lean<any>();
      await post('adminB', '/user-leads/bulk', {
        user: people.staff1.userId,
        leads: [{ _id: String(row._id), mobile: '9000000005' }],
      }).expect(201);
      expect(await m.lead.countDocuments({ branch: branchA })).toBe(1);
    });

    it('a contact id from another company is not trusted', async () => {
      await post('adminA', '/leads', { mobile: '9000000001' }).expect(201);
      const contactA = await m.contact.findOne({ branch: branchA }).lean<any>();
      await post('adminB', '/user-leads/bulk', {
        user: people.staff1.userId,
        leads: [{ contact: String(contactA._id), mobile: '9000000001' }],
      }).expect(201);
      const row = await m.userLead.findOne({ branch: branchB }).lean<any>();
      expect(String(row.contact)).not.toBe(String(contactA._id));
      expect(await contactsOf(branchB)).toBe(1);
    });

    it('unique lead counts: each company sees its own, superadmin sees all and per company', async () => {
      await post('adminA', '/leads', { mobile: '9000000001\n9000000002' }).expect(201);
      await post('adminB', '/leads', { mobile: '9000000001' }).expect(201);

      expect((await get('adminA', '/contacts/stats')).body).toEqual({ total_unique_leads: 2 });
      expect((await get('adminB', '/contacts/stats')).body).toEqual({ total_unique_leads: 1 });
      // an admin cannot ask for another company's figure
      expect((await get('adminA', `/contacts/stats?branch=${branchB}`)).body.total_unique_leads).toBe(2);

      const all = (await get('superadmin', '/contacts/stats')).body;
      expect(all.total_unique_leads).toBe(3);
      expect(all.by_branch.length).toBe(2);
      expect(all.by_branch.find((b) => String(b.branch) === String(branchA))).toMatchObject({ name: 'Company A', total: 2 });

      const one = (await get('superadmin', `/contacts/stats?branch=${branchB}`)).body;
      expect(one).toEqual({ total_unique_leads: 1 });
    });

    it('activity of another company\'s contact cannot be read', async () => {
      await post('adminA', '/user-leads', { user: people.staff1.userId, mobile: '9000000001' }).expect(201);
      const contact = await m.contact.findOne({}).lean<any>();
      await get('adminB', `/contacts/${contact._id}/activity`).expect(404);
      await get('adminA', `/contacts/${contact._id}/activity`).expect(200);
      await get('adminA', '/contacts/not-an-id/activity').expect(404);
    });
  });

  // ------------------------------------------------------- concurrency
  describe('concurrent uploads', () => {
    it('two admins uploading the same new numbers at once never create a duplicate contact', async () => {
      const numbers = Array.from({ length: 300 }, (_, i) => String(9300000000 + i)).join('\n');
      const results = await Promise.all([
        post('adminA', '/leads', { mobile: numbers }),
        post('tlA', '/leads', { mobile: numbers }),
        post('adminA', '/hot-leads/import-excel').attach('file', sheet([['mobile'], ...numbers.split('\n').map((n) => [n])]), 'x.xlsx'),
      ]);
      results.forEach((r) => expect(r.status).toBe(201));

      expect(await contactsOf(branchA)).toBe(300);
      expect(await m.lead.countDocuments({ branch: branchA })).toBe(300); // pool holds each number once
      expect(await m.hot.countDocuments({ branch: branchA })).toBe(300);
      const dup = await m.contact.aggregate([
        { $group: { _id: { b: '$branch', m: '$mobile' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
      ]);
      expect(dup).toEqual([]);
    }, 60000);
  });
});
