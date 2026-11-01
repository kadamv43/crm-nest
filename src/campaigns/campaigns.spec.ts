import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { EmailService } from 'src/email/email.service';
import { attendanceDate } from 'src/common/time.util';
import { ContactsService } from 'src/contacts/contacts.service';
import { CampaignsModule } from './campaigns.module';
import { CampaignsService } from './campaigns.service';
import { batchOf, holderIndex } from './rotation.util';

describe('rotation maths', () => {
  it('every batch meets every person exactly once, and every round is a fair shuffle', () => {
    for (const n of [2, 3, 5, 10, 13]) {
      const seen = new Set<string>();
      for (let round = 1; round <= n; round++) {
        const holders = new Set<number>();
        for (let batch = 0; batch < n; batch++) {
          const h = holderIndex(batch, round, n);
          holders.add(h);
          seen.add(`${batch}-${h}`);
        }
        expect(holders.size).toBe(n); // nobody holds two batches in a round
      }
      expect(seen.size).toBe(n * n); // every batch reached every person
    }
  });

  it('round 1 gives batch b to person b', () => {
    for (let b = 0; b < 7; b++) expect(holderIndex(b, 1, 7)).toBe(b);
  });

  it('batches differ in size by at most one', () => {
    const sizes = new Array(10).fill(0);
    for (let i = 0; i < 103; i++) sizes[batchOf(i, 10)]++;
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b)).toBe(103);
  });
});

// Runs through the real controller and a throwaway MongoDB (TEST_MONGO_URI).
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

describeDb('/campaigns', () => {
  let app: INestApplication;
  let server: any;
  let service: CampaignsService;
  let contacts: ContactsService;
  let m: Record<string, Model<any>>;

  const A = new Types.ObjectId();
  const B = new Types.ObjectId();
  const id = () => new Types.ObjectId();
  const people: Record<string, any> = {
    adminA: { userId: String(id()), role: 'admin', branch: String(A), username: 'adminA' },
    adminB: { userId: String(id()), role: 'admin', branch: String(B), username: 'adminB' },
    root: { userId: String(id()), role: 'superadmin', branch: String(A), username: 'root' },
    tlA: { userId: String(id()), role: 'teamlead', branch: String(A), username: 'tlA' },
    staffA: { userId: String(id()), role: 'employee', branch: String(A), username: 'staffA' },
  };
  const guard = {
    canActivate: (ctx) => {
      const req = ctx.switchToHttp().getRequest();
      const raw = req.headers['x-test-user'];
      if (!raw) throw new UnauthorizedException();
      const p = people[String(raw)];
      req.user = { ...p, branch: { _id: p.branch } };
      return true;
    },
  };
  const call = (who: string | null, method: 'get' | 'post', url: string, body?: any) => {
    const r = (request(server) as any)[method](url);
    if (who) r.set('x-test-user', who);
    return body === undefined ? r : r.send(body);
  };

  let staff: any[] = [];
  const makeStaff = async (n: number, branch = A, prefix = 's') => {
    const rows = Array.from({ length: n }, (_, i) => ({
      _id: id(),
      first_name: 'F' + i,
      last_name: 'L' + i,
      email: `${prefix}${i}@x.com`,
      username: `${prefix}${i}`,
      password: 'x',
      password_text: 'x',
      branch,
      role: 'employee',
    }));
    await m.User.insertMany(rows);
    return rows;
  };
  const fillPool = async (n: number, branch = A, start = 0) => {
    const numbers = Array.from({ length: n }, (_, i) => ({
      mobile: String(9000000000 + start + i),
    }));
    const resolved = await contacts.resolve(String(branch), numbers);
    const rows = resolved.rows.map((r: any) => ({
      contact: r.contact._id,
      mobile: r.mobile,
      branch,
    }));
    return m.Lead.insertMany(rows);
  };
  /** staff work every lead they currently hold */
  const workEverything = (campaignId: any, status = 'RINGING') =>
    m.UserLead.updateMany({ campaign: campaignId, status: 'FRESH' }, { $set: { status } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(uri + '_campaigns'), CampaignsModule],
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
      CampaignLead: app.get(getModelToken('CampaignLead')),
      Lead: app.get(getModelToken('Lead')),
      UserLead: app.get(getModelToken('UserLead')),
      User: app.get(getModelToken('User')),
      Activity: app.get(getModelToken('LeadActivity')),
      Attendance: app.get(getModelToken('Attendance')),
    };
    await Promise.all(Object.values(m).map((x) => x.deleteMany({})));
  });

  afterAll(async () => {
    await Promise.all(Object.values(m).map((x) => x.deleteMany({})));
    await app.close();
  });

  beforeEach(async () => {
    await Promise.all(Object.values(m).map((x) => x.deleteMany({})));
    staff = await makeStaff(10);
  });

  const ids = (rows: any[], n = rows.length) => rows.slice(0, n).map((r) => String(r._id));

  describe('starting a campaign', () => {
    it('100 leads over 10 staff gives 10 each, takes them out of the pool and logs each hand-out', async () => {
      await fillPool(100);
      const res = await call('adminA', 'post', '/campaigns', {
        name: 'Diwali',
        staff: ids(staff),
        count: 100,
      });
      expect(res.status).toBe(201);
      expect(res.body.leads).toBe(100);
      expect(res.body.skipped).toBe(0);

      expect(await m.Lead.countDocuments({ branch: A })).toBe(0);
      for (const s of staff) {
        expect(await m.UserLead.countDocuments({ user: s._id, campaign_round: 1 })).toBe(10);
      }
      const rows = await m.UserLead.find({}).lean();
      expect(rows.every((r: any) => r.status === 'FRESH' && String(r.branch) === String(A))).toBe(true);
      expect(await m.Activity.countDocuments({ type: 'ASSIGNED' })).toBe(100);
      expect(await m.CampaignLead.countDocuments({})).toBe(100);
    });

    it('uneven numbers: 103 leads over 10 staff gives 10 or 11 each', async () => {
      await fillPool(103);
      await call('adminA', 'post', '/campaigns', { name: 'Odd', staff: ids(staff), count: 103 }).expect(201);
      const counts: number[] = [];
      for (const s of staff) counts.push(await m.UserLead.countDocuments({ user: s._id }));
      expect(counts.reduce((a, b) => a + b)).toBe(103);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    });

    it('takes the oldest pool leads first when only a count is given', async () => {
      const rows: any[] = await fillPool(20);
      await m.Lead.updateOne({ _id: rows[19]._id }, { $set: { created_at: new Date('2020-01-01') } });
      await call('adminA', 'post', '/campaigns', { name: 'Old', staff: ids(staff, 2), count: 3 }).expect(201);
      const taken = await m.CampaignLead.find({}).lean();
      expect(taken.map((t: any) => t.mobile)).toContain(rows[19].mobile);
      expect(await m.Lead.countDocuments({})).toBe(17);
    });

    it('picked leads: only those, and ones already taken are skipped, not failed', async () => {
      const rows: any[] = await fillPool(6);
      await m.Lead.deleteOne({ _id: rows[0]._id }); // an admin took it a moment ago
      const res = await call('adminA', 'post', '/campaigns', {
        name: 'Picked',
        staff: ids(staff, 3),
        lead_ids: ids(rows, 4),
      });
      expect(res.status).toBe(201);
      expect(res.body.leads).toBe(3);
      expect(res.body.skipped).toBe(1);
      expect(await m.Lead.countDocuments({})).toBe(2);
    });

    it('never touches another company\'s pool', async () => {
      const mine: any[] = await fillPool(3, A, 0);
      const theirs: any[] = await fillPool(3, B, 500);
      const res = await call('adminA', 'post', '/campaigns', {
        name: 'Mine',
        staff: ids(staff, 2),
        lead_ids: [...ids(mine), ...ids(theirs)],
      });
      expect(res.body.leads).toBe(3);
      expect(await m.Lead.countDocuments({ branch: B })).toBe(3);
    });

    it('rejects bad input and changes nothing', async () => {
      const pool: any[] = await fillPool(5);
      const other = await makeStaff(2, B, 'o');
      const tl = (await m.User.create({ ...people.tlA, _id: people.tlA.userId, first_name: 'T', last_name: 'L', email: 't@x.com', password: 'x', password_text: 'x', branch: A, role: 'teamlead' })) as any;
      const bad: [string, any][] = [
        ['no name', { staff: ids(staff, 2), count: 2 }],
        ['blank name', { name: '   ', staff: ids(staff, 2), count: 2 }],
        ['long name', { name: 'x'.repeat(81), staff: ids(staff, 2), count: 2 }],
        ['no staff', { name: 'n', count: 2 }],
        ['one staff', { name: 'n', staff: ids(staff, 1), count: 2 }],
        ['same staff twice', { name: 'n', staff: [ids(staff)[0], ids(staff)[0]], count: 2 }],
        ['not an id', { name: 'n', staff: ['abc', ids(staff)[0]], count: 2 }],
        ['another company\'s staff', { name: 'n', staff: [ids(staff)[0], String(other[0]._id)], count: 2 }],
        ['a team lead', { name: 'n', staff: [ids(staff)[0], String(tl._id)], count: 2 }],
        ['too many staff', { name: 'n', staff: [...ids(staff), ...ids(await makeStaff(45, A, 'z'))], count: 2 }],
        ['neither leads nor count', { name: 'n', staff: ids(staff, 2) }],
        ['both leads and count', { name: 'n', staff: ids(staff, 2), count: 2, lead_ids: ids(pool, 2) }],
        ['count zero', { name: 'n', staff: ids(staff, 2), count: 0 }],
        ['count fraction', { name: 'n', staff: ids(staff, 2), count: 1.5 }],
        ['count text', { name: 'n', staff: ids(staff, 2), count: 'abc' }],
        ['count too big', { name: 'n', staff: ids(staff, 2), count: 10001 }],
        ['empty lead list', { name: 'n', staff: ids(staff, 2), lead_ids: [] }],
        ['bad lead id', { name: 'n', staff: ids(staff, 2), lead_ids: ['zzz'] }],
      ];
      for (const [label, body] of bad) {
        const res = await call('adminA', 'post', '/campaigns', body);
        expect([label, res.status]).toEqual([label, 400]);
      }
      expect(await m.Campaign.countDocuments({})).toBe(0);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(5);
      expect(await m.UserLead.countDocuments({})).toBe(0);
    });

    it('an empty pool is an error and leaves no campaign behind', async () => {
      const res = await call('adminA', 'post', '/campaigns', { name: 'None', staff: ids(staff, 2), count: 5 });
      expect(res.status).toBe(400);
      expect(await m.Campaign.countDocuments({})).toBe(0);
    });

    it('the same name twice is refused (409), and the second attempt takes no leads', async () => {
      await fillPool(10);
      await call('adminA', 'post', '/campaigns', { name: 'Dup', staff: ids(staff, 2), count: 4 }).expect(201);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Dup', staff: ids(staff, 2), count: 4 });
      expect(res.status).toBe(409);
      expect(await m.Lead.countDocuments({})).toBe(6);
    });

    it('the same name is fine in another company', async () => {
      await fillPool(4);
      await fillPool(4, B, 100);
      const other = await makeStaff(2, B, 'o');
      await call('adminA', 'post', '/campaigns', { name: 'Same', staff: ids(staff, 2), count: 2 }).expect(201);
      await call('adminB', 'post', '/campaigns', { name: 'Same', staff: ids(other), count: 2 }).expect(201);
    });

    it('if handing out fails, every lead goes back to the pool and nothing is left half-made', async () => {
      await fillPool(12);
      const spy = jest.spyOn((service as any).activity, 'logAssigned').mockRejectedValueOnce(new Error('boom'));
      const res = await call('adminA', 'post', '/campaigns', { name: 'Fail', staff: ids(staff, 3), count: 12 });
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(12);
      expect(await m.Campaign.countDocuments({})).toBe(0);
      expect(await m.CampaignLead.countDocuments({})).toBe(0);
      expect(await m.UserLead.countDocuments({})).toBe(0);
      // and the same campaign can be started again
      await call('adminA', 'post', '/campaigns', { name: 'Fail', staff: ids(staff, 3), count: 12 }).expect(201);
    });
  });

  describe('rotating', () => {
    const start = async (leads = 100, people = 10, name = 'Rot') => {
      await fillPool(leads);
      const res = await call('adminA', 'post', '/campaigns', { name, staff: ids(staff, people), count: leads });
      expect(res.status).toBe(201);
      return res.body._id as string;
    };
    const next = (cid: string, who = 'adminA') => call(who, 'post', `/campaigns/${cid}/next-round`);

    it('after 10 rounds every staff member has had all 100 numbers, once each, and every lead met all 10', async () => {
      const cid = await start(100, 10);
      for (let round = 1; round <= 10; round++) {
        await workEverything(cid);
        if (round < 10) {
          const res = await next(cid);
          expect(res.status).toBe(201);
          expect(res.body.round).toBe(round + 1);
          expect(res.body.moved).toBe(100);
          expect(res.body.untouched_retained).toBe(0);
        }
      }
      const rows: any[] = await m.UserLead.find({ campaign: cid }).lean();
      expect(rows.length).toBe(1000);

      const perStaff = new Map<string, Set<string>>();
      const perLead = new Map<string, Set<string>>();
      for (const r of rows) {
        const u = String(r.user);
        const c = String(r.contact);
        if (!perStaff.has(u)) perStaff.set(u, new Set());
        if (!perLead.has(c)) perLead.set(c, new Set());
        expect(perStaff.get(u)!.has(c)).toBe(false); // never a repeat for one person
        perStaff.get(u)!.add(c);
        perLead.get(c)!.add(u);
      }
      expect(perStaff.size).toBe(10);
      perStaff.forEach((set) => expect(set.size).toBe(100));
      expect(perLead.size).toBe(100);
      perLead.forEach((set) => expect(set.size).toBe(10));

      // an 11th round does not exist
      const extra = await next(cid);
      expect(extra.status).toBe(409);
    });

    it('moves exactly one step along: staff 1\'s leads go to staff 2', async () => {
      const cid = await start(20, 4);
      const before: any[] = await m.UserLead.find({ campaign: cid, user: staff[0]._id }).lean();
      await workEverything(cid);
      await next(cid).expect(201);
      const after: any[] = await m.UserLead.find({ campaign: cid, user: staff[1]._id, campaign_round: 2 }).lean();
      expect(after.map((r) => String(r.contact)).sort()).toEqual(before.map((r) => String(r.contact)).sort());
      // the last person's batch wraps round to the first
      const last: any[] = await m.UserLead.find({ campaign: cid, user: staff[3]._id, campaign_round: 1 }).lean();
      const wrapped: any[] = await m.UserLead.find({ campaign: cid, user: staff[0]._id, campaign_round: 2 }).lean();
      expect(wrapped.map((r) => String(r.contact)).sort()).toEqual(last.map((r) => String(r.contact)).sort());
    });

    it('finished leads (paid, not interested, dead) stop rotating; the rest carry on', async () => {
      const cid = await start(12, 3);
      const rows: any[] = await m.UserLead.find({ campaign: cid }).sort({ _id: 1 }).lean();
      const set = (i: number, status: string) => m.UserLead.updateOne({ _id: rows[i]._id }, { $set: { status } });
      await set(0, 'PAYMENT_DONE');
      await set(1, 'NOT_INTERESTED');
      await set(2, 'DEAD');
      await set(3, 'CALLBACK');
      await set(4, 'EXPECTED_PAYMENT');
      await set(5, 'RINGING');
      const res = await next(cid);
      expect(res.body.finished).toBe(3);
      expect(res.body.moved).toBe(9);
      expect(await m.CampaignLead.countDocuments({ campaign: cid, done: true })).toBe(3);
      const second = await m.UserLead.find({ campaign: cid, campaign_round: 2 }).lean();
      const movedContacts = second.map((r: any) => String(r.contact));
      for (const i of [0, 1, 2]) expect(movedContacts).not.toContain(String(rows[i].contact));
      // finished leads stay finished in later rounds too
      await workEverything(cid);
      const again = await next(cid);
      expect(again.body.finished).toBe(0);
      expect(again.body.moved).toBe(9);
    });

    it('a new round adds fresh assignments and keeps the previous holders\' fresh leads', async () => {
      const cid = await start(9, 3);
      const rows: any[] = await m.UserLead.find({ campaign: cid }).lean();
      await m.UserLead.updateMany({ _id: { $in: rows.slice(0, 4).map((r) => r._id) } }, { $set: { status: 'RINGING' } });
      const res = await next(cid);
      expect(res.body.untouched_retained).toBe(5);
      expect(res.body.moved).toBe(9);
      const fresh = await m.UserLead.find({ campaign: cid, status: 'FRESH' }).lean();
      expect(fresh.length).toBe(14); // five retained from round one plus nine new hand-outs
      expect(fresh.filter((r: any) => r.campaign_round === 1).length).toBe(5);
      expect(fresh.filter((r: any) => r.campaign_round === 2).length).toBe(9);
      const holders = new Map<string, number>();
      for (const r of await m.UserLead.find({ campaign: cid, campaign_round: 2 }).lean()) {
        holders.set(String((r as any).contact), (holders.get(String((r as any).contact)) ?? 0) + 1);
      }
      holders.forEach((n) => expect(n).toBe(1));
    });

    it('the lead keeps its history: old worked rows stay, the new row is another line on the same contact', async () => {
      const cid = await start(6, 3);
      await workEverything(cid, 'CALLBACK');
      await next(cid).expect(201);
      const lead: any = await m.CampaignLead.findOne({ campaign: cid }).lean();
      const rows = await m.UserLead.find({ campaign: cid, contact: lead.contact }).sort({ campaign_round: 1 }).lean();
      expect(rows.map((r: any) => [r.campaign_round, r.status])).toEqual([[1, 'CALLBACK'], [2, 'FRESH']]);
      expect(await m.Activity.countDocuments({ contact: lead.contact, type: 'ASSIGNED' })).toBe(2);
    });

    it('two clicks at once: one wins, the other is told (409), nothing is handed out twice', async () => {
      const cid = await start(30, 5);
      await workEverything(cid);
      const [a, b] = await Promise.all([next(cid), next(cid)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await m.UserLead.countDocuments({ campaign: cid, campaign_round: 2 })).toBe(30);
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(2);
    });

    it('retrying after a failed attempt does not hand anything out twice', async () => {
      const cid = await start(20, 4);
      await workEverything(cid);
      const spy = jest.spyOn((service as any).activity, 'logAssigned').mockRejectedValueOnce(new Error('boom'));
      const failed = await next(cid);
      spy.mockRestore();
      expect(failed.status).toBe(500);
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(1); // put back
      const retry = await next(cid);
      expect(retry.status).toBe(201);
      const round2 = await m.UserLead.find({ campaign: cid, campaign_round: 2 }).lean();
      expect(round2.length).toBe(20);
      expect(new Set(round2.map((r: any) => String(r.contact))).size).toBe(20);
    });

    it('a closed campaign cannot rotate, and cannot be closed twice', async () => {
      const cid = await start(6, 3);
      await call('adminA', 'post', `/campaigns/${cid}/close`).expect(201);
      expect((await next(cid)).status).toBe(409);
      expect((await call('adminA', 'post', `/campaigns/${cid}/close`)).status).toBe(409);
      const detail = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(detail.body.status).toBe('COMPLETED');
      expect(detail.body.can_next_round).toBe(false);
    });

    it('a staff member removed from the company stops the move before anything changes', async () => {
      const cid = await start(6, 3);
      await m.User.deleteOne({ _id: staff[1]._id });
      const res = await next(cid);
      expect(res.status).toBe(409);
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(1);
      expect(await m.UserLead.countDocuments({ campaign: cid })).toBe(6);
    });

    it('a staff member cannot change which campaign a row belongs to', async () => {
      const cid = await start(4, 2);
      const { UserLeadsService } = await import('src/user-leads/user-leads.service');
      const row: any = await m.UserLead.findOne({ campaign: cid }).lean();
      const svc = new UserLeadsService(m.UserLead as any, contacts, (service as any).activity);
      await svc.update(String(row._id), { status: 'RINGING', campaign: String(new Types.ObjectId()), campaign_round: 9 } as any, people.staffA.userId);
      const after: any = await m.UserLead.findById(row._id).lean();
      expect(String(after.campaign)).toBe(cid);
      expect(after.campaign_round).toBe(1);
      expect(after.status).toBe('RINGING');
    });
  });

  describe('reading', () => {
    it('detail shows who holds what, who worked what, and whether a next round is possible', async () => {
      await fillPool(12);
      const cid = (await call('adminA', 'post', '/campaigns', { name: 'Detail', staff: ids(staff, 3), count: 12 })).body._id;
      const mine: any[] = await m.UserLead.find({ campaign: cid, user: staff[0]._id }).lean();
      await m.UserLead.updateOne({ _id: mine[0]._id }, { $set: { status: 'PAYMENT_DONE' } });
      await m.UserLead.updateOne({ _id: mine[1]._id }, { $set: { status: 'RINGING' } });

      const res = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: 'Detail', round: 1, rounds: 3, total_leads: 12, finished: 1, untouched: 10, can_next_round: true, status: 'ACTIVE' });
      expect(res.body.statuses).toEqual({ FRESH: 10, PAYMENT_DONE: 1, RINGING: 1 });
      expect(res.body.staff.length).toBe(3);
      expect(res.body.staff[0]).toMatchObject({ username: 's0', holding: 4, untouched: 2, assigned_total: 4, worked_total: 2 });

      await workEverything(cid);
      await call('adminA', 'post', `/campaigns/${cid}/next-round`).expect(201);
      await workEverything(cid);
      await call('adminA', 'post', `/campaigns/${cid}/next-round`).expect(201);
      const last = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(last.body.can_next_round).toBe(false);
      expect(last.body.round).toBe(3);
    });

    it('the list shows newest first and only the own company', async () => {
      await m.User.create({ _id: people.adminA.userId, first_name: "A", last_name: "A", email: "a@x.com", username: "adminA", password: "x", password_text: "x", branch: A, role: "admin" });
      await fillPool(6);
      await fillPool(4, B, 300);
      const other = await makeStaff(2, B, 'o');
      await call('adminA', 'post', '/campaigns', { name: 'One', staff: ids(staff, 2), count: 2 }).expect(201);
      await call('adminA', 'post', '/campaigns', { name: 'Two', staff: ids(staff, 3), count: 3 }).expect(201);
      await call('adminB', 'post', '/campaigns', { name: 'Theirs', staff: ids(other), count: 2 }).expect(201);
      const res = await call('adminA', 'get', '/campaigns');
      expect(res.body.map((c: any) => c.name)).toEqual(['Two', 'One']);
      expect(res.body[0]).toMatchObject({ rounds: 3, round: 1, total_leads: 3, created_by: "adminA" });
    });

    it('staff list marks who logged in today', async () => {
      await m.Attendance.create({ user: staff[2]._id, branch: A, date: attendanceDate(), first_login_at: new Date(), last_login_at: new Date(), login_count: 1 });
      await m.Attendance.create({ user: staff[3]._id, branch: A, date: '2001-01-01', first_login_at: new Date(), last_login_at: new Date(), login_count: 1 });
      await makeStaff(2, B, 'o');
      const res = await call('adminA', 'get', '/campaigns/staff');
      expect(res.body.length).toBe(10);
      expect(res.body.filter((s: any) => s.present).map((s: any) => s.username)).toEqual(['s2']);
    });
  });

  describe('who may do what', () => {
    it('only admin and superadmin; staff, team leads and logged-out callers are refused', async () => {
      for (const who of ['staffA', 'tlA']) {
        expect((await call(who, 'get', '/campaigns')).status).toBe(403);
        expect((await call(who, 'post', '/campaigns', {})).status).toBe(403);
        expect((await call(who, 'post', `/campaigns/${id()}/next-round`)).status).toBe(403);
        expect((await call(who, 'post', `/campaigns/${id()}/close`)).status).toBe(403);
        expect((await call(who, 'get', '/campaigns/staff')).status).toBe(403);
      }
      expect((await call(null, 'get', '/campaigns')).status).toBe(401);
    });

    it('another company\'s admin cannot see, rotate or close a campaign', async () => {
      await fillPool(6);
      const cid = (await call('adminA', 'post', '/campaigns', { name: 'Private', staff: ids(staff, 3), count: 6 })).body._id;
      expect((await call('adminB', 'get', `/campaigns/${cid}`)).status).toBe(404);
      expect((await call('adminB', 'post', `/campaigns/${cid}/next-round`)).status).toBe(404);
      expect((await call('adminB', 'post', `/campaigns/${cid}/close`)).status).toBe(404);
      // an admin cannot pick another company by adding ?branch=
      expect((await call('adminB', 'get', `/campaigns/${cid}?branch=${A}`)).status).toBe(404);
      expect((await call('adminB', 'get', `/campaigns?branch=${A}`)).body).toEqual([]);
    });

    it('a malformed id is a clean 404', async () => {
      expect((await call('adminA', 'get', '/campaigns/not-an-id')).status).toBe(404);
    });

    it('superadmin must name the company, then can act in it', async () => {
      await fillPool(4);
      expect((await call('root', 'get', '/campaigns')).status).toBe(400);
      expect((await call('root', 'post', '/campaigns', { name: 'x', staff: ids(staff, 2), count: 2 })).status).toBe(400);
      const res = await call('root', 'post', `/campaigns?branch=${A}`, { name: 'Root', staff: ids(staff, 2), count: 4 });
      expect(res.status).toBe(201);
      const list = await call('root', 'get', `/campaigns?branch=${A}`);
      expect(list.body.map((c: any) => c.name)).toEqual(['Root']);
      expect((await call('root', 'post', `/campaigns/${res.body._id}/next-round?branch=${A}`)).status).toBe(201);
    });
  });
});
