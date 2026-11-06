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
import { batchOf, holderIndex, planRound } from './rotation.util';

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
  const makeStaff = async (n: number, branch = A, prefix = 's', loggedIn = true) => {
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
    if (loggedIn) {
      await m.Attendance.insertMany(rows.map((u) => ({ user: u._id, branch, date: attendanceDate(), first_login_at: new Date(), last_login_at: new Date(), login_count: 1 })));
    }
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
  const fillHotPool = async (n: number, branch = A, start = 0) => {
    const resolved = await contacts.resolve(String(branch), Array.from({ length: n }, (_, i) => ({ mobile: String(9500000000 + start + i) })));
    return m.HotLead.insertMany(resolved.rows.map((r: any) => ({ contact: r.contact._id, mobile: r.mobile, branch })));
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
      HotLead: app.get(getModelToken('HotLead')),
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

  describe('who can be chosen when starting', () => {
    it('every employee of the company can be chosen, logged in today or not', async () => {
      await fillPool(6);
      const away = await makeStaff(2, A, 'away', false);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Anyone', staff: [String(staff[0]._id), ...away.map((u) => String(u._id))], count: 6 });
      expect(res.status).toBe(201);
      expect(await m.UserLead.countDocuments({ campaign: res.body._id })).toBe(6);
      expect(await m.UserLead.countDocuments({ campaign: res.body._id, user: away[0]._id })).toBe(2);
    });

    it('the staff list gives everyone, marking who is logged in', async () => {
      await makeStaff(2, A, 'away', false);
      const res = await call('adminA', 'get', '/campaigns/staff');
      expect(res.body).toHaveLength(staff.length + 2);
      expect(res.body.filter((s: any) => !s.present)).toHaveLength(2);
    });

    it('still only staff of this company', async () => {
      await fillPool(4);
      const other = await makeStaff(1, B, 'other', false);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Mixed', staff: [String(staff[0]._id), String(other[0]._id)], count: 4 });
      expect(res.status).toBe(400);
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

  describe('hot lead campaigns', () => {
    const startHot = (body: any = {}, who = 'adminA') =>
      call(who, 'post', '/campaigns', { name: 'Hot one', staff: ids(staff, 4), count: 12, lead_type: 'HOT', ...body });
    const next = (cid: string) => call('adminA', 'post', `/campaigns/${cid}/next-round`);

    it('takes the leads from the hot pool, leaves the normal pool alone, and hands them out as hot', async () => {
      await fillHotPool(12);
      await fillPool(7);
      const res = await startHot();
      expect(res.status).toBe(201);
      expect(res.body.leads).toBe(12);
      expect(await m.HotLead.countDocuments({ branch: A })).toBe(0);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(7);
      const rows: any[] = await m.UserLead.find({ campaign: res.body._id }).lean();
      expect(rows.length).toBe(12);
      expect(rows.every((r) => r.is_hot_lead === true && r.status === 'FRESH' && String(r.branch) === String(A))).toBe(true);
      for (const s of staff.slice(0, 4)) {
        expect(await m.UserLead.countDocuments({ user: s._id, campaign: res.body._id })).toBe(3);
      }
      expect(await m.Activity.countDocuments({ type: 'ASSIGNED' })).toBe(12);
    });

    it('a normal campaign is unchanged: normal pool only, rows not hot', async () => {
      await fillHotPool(5);
      await fillPool(6);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Plain', staff: ids(staff, 2), count: 6 });
      expect(res.status).toBe(201);
      expect(await m.HotLead.countDocuments({ branch: A })).toBe(5);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(0);
      const rows: any[] = await m.UserLead.find({ campaign: res.body._id }).lean();
      expect(rows.every((r) => r.is_hot_lead === false)).toBe(true);
      const detail = await call('adminA', 'get', `/campaigns/${res.body._id}`);
      expect(detail.body.lead_type).toBe('NORMAL');
    });

    it('the type is shown in the list and the opened campaign', async () => {
      await fillHotPool(4);
      await fillPool(4, A, 100);
      const hot = await startHot({ name: 'H', count: 4, staff: ids(staff, 2) });
      await call('adminA', 'post', '/campaigns', { name: 'N', staff: ids(staff, 2), count: 4 }).expect(201);
      const list = await call('adminA', 'get', '/campaigns');
      expect(Object.fromEntries(list.body.map((c: any) => [c.name, c.lead_type]))).toEqual({ H: 'HOT', N: 'NORMAL' });
      expect((await call('adminA', 'get', `/campaigns/${hot.body._id}`)).body.lead_type).toBe('HOT');
    });

    it('every round keeps handing out hot leads, nobody gets a number twice, and the status choice works', async () => {
      await fillHotPool(8);
      const res = await startHot({ count: 8, staff: ids(staff, 4), move_statuses: ['RINGING', 'FRESH'] });
      const cid = res.body._id;
      for (let round = 2; round <= 4; round++) {
        await m.UserLead.updateMany({ campaign: cid, status: 'FRESH' }, { $set: { status: 'RINGING' } });
        const out = await next(cid);
        expect([round, out.status]).toEqual([round, 201]);
        expect(out.body.moved).toBe(8);
      }
      const all: any[] = await m.UserLead.find({ campaign: cid }).lean();
      expect(all.length).toBe(32);
      expect(all.every((r) => r.is_hot_lead === true)).toBe(true);
      const seen = new Set<string>();
      for (const r of all) {
        const key = `${r.user}-${r.contact}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      // a status that was not chosen stays put
      expect((await next(cid)).status).toBe(409);
    });

    it('staff find them on My Hot Leads and admins on Assigned Hot Leads, not on the normal pages', async () => {
      const { UserLeadsService } = await import('src/user-leads/user-leads.service');
      const userLeads = new UserLeadsService(m.UserLead as any, contacts, (service as any).activity);
      await fillHotPool(4);
      await fillPool(4, A, 100);
      const hot = await startHot({ name: 'Seen', count: 4, staff: ids(staff, 2) });
      const normal = await call('adminA', 'post', '/campaigns', { name: 'Seen normal', staff: ids(staff, 2), count: 4 });
      expect(hot.status).toBe(201);
      expect(normal.status).toBe(201);

      const mine: any = await userLeads.getByUserIdHotLeads(String(staff[0]._id), { page: 0, size: 50 });
      expect(mine.data.length).toBe(2);
      expect(mine.data.every((r: any) => String(r.campaign) === String(hot.body._id))).toBe(true);
      const assignedHot: any = await userLeads.getAssigneddHotLeads('x', { page: 0, size: 50 }, String(A));
      expect(assignedHot.total).toBe(4);
      const assignedNormal: any = await userLeads.getAssignedLeads('x', { page: 0, size: 50 }, String(A));
      expect(assignedNormal.total).toBe(4);
      expect(assignedNormal.data.every((r: any) => String(r.campaign) === String(normal.body._id))).toBe(true);
    });

    it('picked leads come only from the hot pool of the same company', async () => {
      const hotRows: any[] = await fillHotPool(4);
      const normalRows: any[] = await fillPool(3, A, 100);
      const otherHot: any[] = await fillHotPool(2, B, 500);
      const res = await startHot({ name: 'Picked', count: undefined, staff: ids(staff, 2), lead_ids: [...ids(hotRows), ...ids(normalRows), ...ids(otherHot)] });
      expect(res.status).toBe(201);
      expect(res.body.leads).toBe(4);
      expect(res.body.skipped).toBe(5);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(3);
      expect(await m.HotLead.countDocuments({ branch: B })).toBe(2);
    });

    it('a number waiting in both pools: the hot campaign takes only the hot row', async () => {
      await fillHotPool(3, A, 0);
      await m.Lead.insertMany((await m.HotLead.find({ branch: A }).lean() as any[]).map((r) => ({ contact: r.contact, mobile: r.mobile, branch: A })));
      const res = await startHot({ name: 'Both', count: 3, staff: ids(staff, 3) });
      expect(res.status).toBe(201);
      expect(await m.HotLead.countDocuments({ branch: A })).toBe(0);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(3);
    });

    it('an Excel upload for a hot campaign removes matching rows from the hot pool only', async () => {
      await fillHotPool(2, A, 0);
      await m.Lead.insertMany((await m.HotLead.find({ branch: A }).lean() as any[]).map((r) => ({ contact: r.contact, mobile: r.mobile, branch: A })));
      const out = await service.create(
        { branch: String(A), actorId: String(id()), actorName: 'adminA' },
        {
          name: 'Sheet hot',
          staff: ids(staff, 2),
          lead_type: 'HOT',
          leads: [{ mobile: '9500000000', first_name: 'Asha' }, { mobile: '9500000001' }, { mobile: '9600000000', first_name: 'New' }],
        },
      );
      expect(out.leads).toBe(3);
      expect(await m.HotLead.countDocuments({ branch: A })).toBe(0); // the 2 waiting rows were used
      expect(await m.Lead.countDocuments({ branch: A })).toBe(2); // the normal pool is untouched
      const rows: any[] = await m.UserLead.find({ campaign: out._id }).lean();
      expect(rows.length).toBe(3);
      expect(rows.every((r) => r.is_hot_lead === true)).toBe(true);
      expect(rows.find((r) => r.mobile === '9500000000').name).toBe('Asha');
    });

    it('the type is checked: Hot / hot / HOT work, anything else is refused', async () => {
      await fillHotPool(6);
      for (const [i, value] of ['hot', 'Hot', ' HOT '].entries()) {
        const res = await call('adminA', 'post', '/campaigns', { name: 'T' + i, staff: ids(staff, 2), count: 1, lead_type: value });
        expect([value, res.status]).toEqual([value, 201]);
        expect((await call('adminA', 'get', `/campaigns/${res.body._id}`)).body.lead_type).toBe('HOT');
      }
      const before = await m.HotLead.countDocuments({});
      for (const value of ['WARM', 'both', 5, {}, ['HOT']]) {
        const res = await call('adminA', 'post', '/campaigns', { name: 'Bad' + JSON.stringify(value), staff: ids(staff, 2), count: 1, lead_type: value });
        expect([JSON.stringify(value), res.status]).toEqual([JSON.stringify(value), 400]);
      }
      expect(await m.HotLead.countDocuments({})).toBe(before);
      expect(await m.Campaign.countDocuments({ name: /^Bad/ })).toBe(0);
    });

    it('nothing given means a normal campaign', async () => {
      await fillPool(2);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Default', staff: ids(staff, 2), count: 2 });
      expect((await call('adminA', 'get', `/campaigns/${res.body._id}`)).body.lead_type).toBe('NORMAL');
      for (const empty of [null, '']) {
        await fillPool(1, A, 50);
        const r = await call('adminA', 'post', '/campaigns', { name: 'E' + String(empty), staff: ids(staff, 2), count: 1, lead_type: empty });
        expect(r.status).toBe(201);
      }
    });

    it('an empty hot pool is an error even when the normal pool has leads, and leaves no campaign', async () => {
      await fillPool(9);
      const res = await startHot({ name: 'Empty hot' });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('hot leads');
      expect(await m.Campaign.countDocuments({})).toBe(0);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(9);
    });

    it('if handing out fails, the leads go back to the hot pool', async () => {
      await fillHotPool(6);
      const spy = jest.spyOn((service as any).activity, 'logAssigned').mockRejectedValueOnce(new Error('boom'));
      const res = await startHot({ name: 'Fail hot', count: 6, staff: ids(staff, 3) });
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(await m.HotLead.countDocuments({ branch: A })).toBe(6);
      expect(await m.Lead.countDocuments({ branch: A })).toBe(0);
      expect(await m.UserLead.countDocuments({})).toBe(0);
      await startHot({ name: 'Fail hot', count: 6, staff: ids(staff, 3) }).then((r) => expect(r.status).toBe(201));
    });

    it('another company\'s admin never touches this company\'s hot pool', async () => {
      await fillHotPool(4, A, 0);
      const other = await makeStaff(2, B, 'o');
      const res = await call('adminB', 'post', '/campaigns', { name: 'Not yours', staff: ids(other), count: 4, lead_type: 'HOT' });
      expect(res.status).toBe(400);
      expect(await m.HotLead.countDocuments({ branch: A })).toBe(4);
    });

    it('an older campaign without a type keeps working as a normal one', async () => {
      await fillPool(6);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Old', staff: ids(staff, 3), count: 6 });
      const cid = res.body._id;
      await m.Campaign.collection.updateOne({ _id: new Types.ObjectId(cid) }, { $unset: { lead_type: '' } });
      expect((await call('adminA', 'get', `/campaigns/${cid}`)).body.lead_type).toBe('NORMAL');
      await m.UserLead.updateMany({ campaign: cid }, { $set: { status: 'RINGING' } });
      await next(cid).expect(201);
      const second: any[] = await m.UserLead.find({ campaign: cid, campaign_round: 2 }).lean();
      expect(second.length).toBe(6);
      expect(second.every((r) => r.is_hot_lead === false)).toBe(true);
    });

    it('only admin and superadmin may start one', async () => {
      await fillHotPool(2);
      for (const who of ['staffA', 'tlA']) {
        expect((await startHot({}, who)).status).toBe(403);
      }
      expect(await m.HotLead.countDocuments({ branch: A })).toBe(2);
    });
  });

  describe('rounds are always started by hand', () => {
    it('there is no timer: nothing on the service starts a round by itself', () => {
      const svc: any = app.get(CampaignsService);
      expect(svc.runDueAutoAssignments).toBeUndefined();
      expect(Reflect.getMetadataKeys(CampaignsService.prototype.nextRound).filter((k: any) => /schedule/i.test(String(k)))).toEqual([]);
      // nextRound takes the campaign and who is asking, nothing else
      expect(CampaignsService.prototype.nextRound.length).toBe(2);
    });

    it('asking for automatic rounds when creating is ignored: nothing is stored or moved', async () => {
      await fillPool(8);
      const res = await call('adminA', 'post', '/campaigns', {
        name: 'Hands only', staff: ids(staff, 4), count: 8, auto_assignment: true, interval_minutes: 1,
      });
      expect(res.status).toBe(201);
      const stored: any = await m.Campaign.collection.findOne({ name: 'Hands only' });
      expect(stored.auto_assignment).toBeUndefined();
      expect(stored.interval_minutes).toBeUndefined();
      expect(stored.next_assignment_at).toBeUndefined();
      const detail = await call('adminA', 'get', `/campaigns/${res.body._id}`);
      expect(detail.body.auto_assignment).toBeUndefined();
      expect(detail.body.interval_minutes).toBeUndefined();
      const list = await call('adminA', 'get', '/campaigns');
      expect(list.body[0].auto_assignment).toBeUndefined();
      expect(list.body[0].next_assignment_at).toBeUndefined();
    });

    it('an older campaign that was set to automatic never moves on its own', async () => {
      await fillPool(8);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Old auto', staff: ids(staff, 4), count: 8 });
      const cid = res.body._id;
      // as it looked while the automatic feature existed: due a minute ago
      await m.Campaign.collection.updateOne(
        { _id: new Types.ObjectId(cid) },
        { $set: { auto_assignment: true, interval_minutes: 1, next_assignment_at: new Date(Date.now() - 60_000) } },
      );
      await workEverything(cid);
      await new Promise((r) => setTimeout(r, 1500));
      const campaign: any = await m.Campaign.findById(cid).lean();
      expect(campaign.round).toBe(1);
      expect(await m.UserLead.countDocuments({ campaign: cid, campaign_round: 2 })).toBe(0);
      // and the admin can still start the round by hand
      await call('adminA', 'post', `/campaigns/${cid}/next-round`).expect(201);
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(2);
    });

    it('each press of the button moves exactly one round, whoever and however often', async () => {
      await fillPool(8);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Step', staff: ids(staff, 4), count: 8 });
      const cid = res.body._id;
      for (let round = 2; round <= 4; round++) {
        await workEverything(cid);
        const out = await call('adminA', 'post', `/campaigns/${cid}/next-round`);
        expect(out.status).toBe(201);
        expect(out.body.round).toBe(round);
      }
      expect((await call('adminA', 'post', `/campaigns/${cid}/next-round`)).status).toBe(409);
    });

    it('closing a campaign needs nothing else to be switched off', async () => {
      await fillPool(4);
      const res = await call('adminA', 'post', '/campaigns', { name: 'Close me', staff: ids(staff, 2), count: 4 });
      await call('adminA', 'post', `/campaigns/${res.body._id}/close`).expect(201);
      const stored: any = await m.Campaign.collection.findOne({ name: 'Close me' });
      expect(stored.status).toBe('COMPLETED');
      expect(stored.closed_at).toBeInstanceOf(Date);
    });
  });

  describe('choosing the statuses for each round', () => {
    const start = async (leads = 12, people = 3, name = 'Pick', extra: any = {}) => {
      await fillPool(leads);
      return call('adminA', 'post', '/campaigns', { name, staff: ids(staff, people), count: leads, ...extra });
    };
    const setStatuses = async (cid: any, statuses: string[]) => {
      const rows: any[] = await m.UserLead.find({ campaign: cid }).sort({ _id: 1 }).lean();
      for (let i = 0; i < statuses.length; i++) {
        await m.UserLead.updateOne({ _id: rows[i]._id }, { $set: { status: statuses[i] } });
      }
      return rows;
    };
    const next = (cid: string, body: any = {}) => call('adminA', 'post', `/campaigns/${cid}/next-round`, body);

    it('the first hand-out takes no status choice; the window starts from the default', async () => {
      const res = await start(12, 3, 'First', { move_statuses: ['DEAD'] }); // ignored at creation
      expect(res.status).toBe(201);
      const detail = await call('adminA', 'get', `/campaigns/${res.body._id}`);
      expect(detail.body.move_statuses).toEqual([
        'FRESH', 'CALLBACK', 'FREE_TRIAL', 'RINGING', 'SWITCHED_OFF', 'NOT_REACHABLE', 'EXPECTED_PAYMENT',
      ]);
      expect(detail.body.history).toEqual([]);
      const stored: any = await m.Campaign.collection.findOne({ name: 'First' });
      expect(stored.move_statuses ?? []).toEqual([]); // nothing was stored from the creation request
    });

    it('only the chosen statuses move; the rest stay with their holder', async () => {
      const cid = (await start()).body._id;
      const rows = await setStatuses(cid, ['RINGING', 'RINGING', 'SWITCHED_OFF', 'CALLBACK', 'DEAD', 'PAYMENT_DONE', 'NOT_REACHABLE']);
      const out = await next(cid, { move_statuses: ['RINGING', 'SWITCHED_OFF'] });
      expect(out.status).toBe(201);
      expect(out.body.moved).toBe(3);
      expect(out.body.stayed).toBe(7); // callback, not-reachable, and the 5 still not called
      expect(out.body.finished).toBe(2); // dead and paid are finished, not "stayed"
      expect(out.body.message).toContain('stayed');

      const moved = await m.UserLead.find({ campaign: cid, campaign_round: 2 }).lean();
      expect(moved.map((r: any) => String(r.contact)).sort()).toEqual(
        [rows[0], rows[1], rows[2]].map((r) => String(r.contact)).sort(),
      );
      for (const i of [3, 4, 5, 6]) {
        expect(await m.UserLead.countDocuments({ campaign: cid, contact: rows[i].contact })).toBe(1);
      }
    });

    it('a lead that stayed is not finished: it can move in a later round', async () => {
      const cid = (await start(12, 3)).body._id;
      const rows = await setStatuses(cid, ['CALLBACK']);
      await next(cid, { move_statuses: ['RINGING'] }).then((r) => {
        // nothing is ringing yet, so this round has nothing to move
        expect(r.status).toBe(409);
      });
      await m.UserLead.updateOne({ _id: rows[0]._id }, { $set: { status: 'RINGING' } });
      const out = await next(cid, { move_statuses: ['RINGING'] });
      expect(out.status).toBe(201);
      expect(out.body.moved).toBe(1);
      expect(await m.CampaignLead.countDocuments({ campaign: cid, done: true })).toBe(0);
      expect(await m.UserLead.countDocuments({ campaign: cid, contact: rows[0].contact })).toBe(2);
    });

    it('a finished status can be chosen on purpose, and then it moves on', async () => {
      const cid = (await start()).body._id;
      const rows = await setStatuses(cid, ['PAYMENT_DONE', 'RINGING']);
      const out = await next(cid, { move_statuses: ['PAYMENT_DONE'] });
      expect(out.body.moved).toBe(1);
      expect(out.body.finished).toBe(0);
      expect(await m.UserLead.countDocuments({ campaign: cid, contact: rows[0].contact })).toBe(2);
      expect(await m.CampaignLead.countDocuments({ campaign: cid, done: true })).toBe(0);
    });

    it('choosing "not called yet" (FRESH) moves the leads nobody has touched', async () => {
      const cid = (await start()).body._id;
      await setStatuses(cid, ['RINGING', 'RINGING']);
      const out = await next(cid, { move_statuses: ['FRESH'] });
      expect(out.body.moved).toBe(10);
      expect(out.body.stayed).toBe(2);
    });

    it('each round can have its own statuses, and each choice is kept in the history', async () => {
      const cid = (await start(12, 4, 'Own')).body._id;
      await setStatuses(cid, ['RINGING', 'RINGING', 'CALLBACK', 'CALLBACK', 'RINGING', 'RINGING']);
      await next(cid, { move_statuses: ['RINGING'] }).expect(201);
      await m.UserLead.updateMany({ campaign: cid, campaign_round: 2 }, { $set: { status: 'CALLBACK' } });
      await next(cid, { move_statuses: ['CALLBACK', 'RINGING'] }).expect(201);

      const detail = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(detail.body.history.map((h: any) => [h.round, h.move_statuses, h.staff])).toEqual([
        [2, ['RINGING'], 4],
        [3, ['CALLBACK', 'RINGING'], 4],
      ]);
      expect(detail.body.history[0].moved).toBe(4);
      expect(detail.body.move_statuses).toEqual(['CALLBACK', 'RINGING']); // the window starts from the last choice
    });

    it('leaving the statuses out reuses the last choice', async () => {
      const cid = (await start(12, 4, 'Reuse')).body._id;
      await setStatuses(cid, ['RINGING', 'RINGING', 'RINGING', 'CALLBACK']);
      await next(cid, { move_statuses: ['RINGING'] }).expect(201);
      await m.UserLead.updateMany({ campaign: cid, campaign_round: 2 }, { $set: { status: 'RINGING' } });
      const again = await next(cid); // no statuses sent
      expect(again.status).toBe(201);
      expect(again.body.moved).toBe(3);
      const detail = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(detail.body.history[1].move_statuses).toEqual(['RINGING']);
    });

    it('bad choices are refused and the round does not change', async () => {
      const cid = (await start()).body._id;
      await setStatuses(cid, ['RINGING']);
      const bad: [string, any][] = [
        ['empty list', []],
        ['unknown status', ['RINGING', 'LOST_IN_SPACE']],
        ['not a list', 'RINGING'],
        ['a number', 5],
        ['an object', { a: 1 }],
        ['broken text', '[RINGING'],
      ];
      for (const [label, value] of bad) {
        const res = await next(cid, { move_statuses: value });
        expect([label, res.status]).toEqual([label, 400]);
      }
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(1);
      expect(await m.UserLead.countDocuments({ campaign: cid, campaign_round: 2 })).toBe(0);
    });

    it('repeats in the choice are ignored', async () => {
      const cid = (await start()).body._id;
      await setStatuses(cid, ['RINGING']);
      await next(cid, { move_statuses: ['RINGING', 'RINGING', 'DEAD'] }).expect(201);
      const detail = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(detail.body.history[0].move_statuses).toEqual(['RINGING', 'DEAD']);
    });

    it('a round where nothing can move is refused with the reason, and does not use up the round', async () => {
      const cid = (await start()).body._id;
      await setStatuses(cid, ['CALLBACK', 'CALLBACK']);
      const out = await next(cid, { move_statuses: ['RINGING'] });
      expect(out.status).toBe(409);
      expect(out.body.message).toContain('No lead can move');
      expect(out.body.message).toContain('not in the chosen statuses');
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(1);
      expect(await m.UserLead.countDocuments({ campaign: cid })).toBe(12);
    });

    it('an older campaign that had one fixed choice starts the window from it', async () => {
      const cid = (await start()).body._id;
      await m.Campaign.collection.updateOne({ _id: new Types.ObjectId(cid) }, { $set: { move_statuses: ['RINGING', 'DEAD'] } });
      expect((await call('adminA', 'get', `/campaigns/${cid}`)).body.move_statuses).toEqual(['RINGING', 'DEAD']);
      await setStatuses(cid, ['RINGING', 'DEAD', 'CALLBACK']);
      const out = await next(cid); // statuses left out -> the old setting
      expect(out.body.moved).toBe(2);
    });

    it('runs a whole campaign: statuses chosen on every round from the second', async () => {
      const cid = (await start(12, 4, 'AllRounds')).body._id;
      const setAll = async (round: number, statuses: string[]) => {
        const rows: any[] = await m.UserLead.find({ campaign: cid, campaign_round: round }).sort({ _id: 1 }).lean();
        for (let i = 0; i < rows.length; i++) {
          await m.UserLead.updateOne({ _id: rows[i]._id }, { $set: { status: statuses[i % statuses.length] } });
        }
      };
      await setAll(1, ['RINGING', 'CALLBACK']);
      const r2 = await next(cid, { move_statuses: ['RINGING'] });
      expect([r2.body.round, r2.body.moved, r2.body.stayed]).toEqual([2, 6, 6]);

      await setAll(2, ['RINGING', 'DEAD']);
      const callbackRow: any = await m.UserLead.findOne({ campaign: cid, campaign_round: 1, status: 'CALLBACK' }).lean();
      await m.UserLead.updateOne({ _id: callbackRow._id }, { $set: { status: 'RINGING' } });
      const r3 = await next(cid, { move_statuses: ['RINGING'] });
      expect([r3.body.round, r3.body.moved, r3.body.finished]).toEqual([3, 4, 3]);

      await setAll(3, ['RINGING']);
      const r4 = await next(cid, { move_statuses: ['RINGING'] });
      expect([r4.body.round, r4.body.moved]).toEqual([4, 4]);

      // the lead that stayed back in round 1 skipped a turn, so it still has one person to visit
      await setAll(4, ['RINGING']);
      const r5 = await next(cid, { move_statuses: ['RINGING'] });
      expect([r5.status, r5.body.moved]).toEqual([201, 1]);
      await m.UserLead.updateMany({ campaign: cid, campaign_round: 5 }, { $set: { status: 'RINGING' } });

      // now these four people have had every lead that is still going
      const r6 = await next(cid, { move_statuses: ['RINGING'] });
      expect(r6.status).toBe(409);

      const all: any[] = await m.UserLead.find({ campaign: cid }).lean();
      const seen = new Set<string>();
      for (const r of all) {
        const key = `${r.user}-${r.contact}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });
  });

  describe('choosing the staff for each round', () => {
    const start = async (leads = 12, people = 3, name = 'People') => {
      await fillPool(leads);
      return (await call('adminA', 'post', '/campaigns', { name, staff: ids(staff, people), count: leads })).body._id as string;
    };
    const workAll = (cid: string) => m.UserLead.updateMany({ campaign: cid, status: 'FRESH' }, { $set: { status: 'RINGING' } });
    const next = (cid: string, body: any = {}) => call('adminA', 'post', `/campaigns/${cid}/next-round`, body);
    const noRepeats = async (cid: string) => {
      const all: any[] = await m.UserLead.find({ campaign: cid }).lean();
      const seen = new Set<string>();
      for (const r of all) {
        const key = `${r.user}-${r.contact}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    };
    const perStaff = async (cid: string, round: number) => {
      const out: Record<string, number> = {};
      for (const r of (await m.UserLead.find({ campaign: cid, campaign_round: round }).lean()) as any[]) {
        out[String(r.user)] = (out[String(r.user)] ?? 0) + 1;
      }
      return out;
    };

    it('other people can take part in a later round, and the campaign remembers them', async () => {
      const cid = await start(12, 3);
      await workAll(cid);
      const out = await next(cid, { staff: ids(staff.slice(3, 6)) });
      expect(out.status).toBe(201);
      expect(out.body.moved).toBe(12);
      const counts = await perStaff(cid, 2);
      expect(Object.keys(counts).sort()).toEqual(ids(staff.slice(3, 6)).sort());
      expect(Object.values(counts)).toEqual([4, 4, 4]); // a level load
      await noRepeats(cid);
      const detail = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(detail.body.staff.map((s: any) => s.username).sort()).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
      expect(detail.body.history[0].staff).toBe(3);
    });

    it('someone absent is simply left out: the others share the leads evenly', async () => {
      const cid = await start(12, 4);
      await workAll(cid);
      const out = await next(cid, { staff: ids(staff, 4).filter((_, i) => i !== 1) }); // s1 is away
      expect(out.status).toBe(201);
      expect(out.body.moved + out.body.no_candidate).toBe(12);
      const counts = await perStaff(cid, 2);
      expect(Object.keys(counts)).not.toContain(String(staff[1]._id));
      const sizes = Object.values(counts);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      await noRepeats(cid);
    });

    it('a single person can take a round', async () => {
      const cid = await start(12, 3);
      await workAll(cid);
      const out = await next(cid, { staff: [String(staff[7]._id)] });
      expect(out.body.moved).toBe(12);
      expect(await m.UserLead.countDocuments({ campaign: cid, user: staff[7]._id, campaign_round: 2 })).toBe(12);
    });

    it('a lead nobody chosen can take stays put, and the answer says how many', async () => {
      const cid = await start(12, 3); // s0 holds 4 leads
      await workAll(cid);
      const out = await next(cid, { staff: [String(staff[0]._id)] });
      expect(out.status).toBe(201);
      expect(out.body.moved).toBe(8);
      expect(out.body.no_candidate).toBe(4); // the ones s0 already had
      expect(out.body.message).toContain('everyone chosen already had them');
      await noRepeats(cid);
    });

    it('if everyone chosen has had everything, the round is refused and nothing changes', async () => {
      const cid = await start(12, 3);
      await workAll(cid);
      await next(cid, { staff: ids(staff, 3) }).expect(201); // the circle, round 2
      await workAll(cid);
      await next(cid, { staff: ids(staff, 3) }).expect(201); // round 3
      await workAll(cid);
      const out = await next(cid, { staff: ids(staff, 3) });
      expect(out.status).toBe(409);
      expect(out.body.message).toContain('already had by everyone chosen');
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(3);
    });

    it('with the same people every time it is still the plain circle', async () => {
      const cid = await start(12, 4);
      const before: any[] = await m.UserLead.find({ campaign: cid, user: staff[0]._id }).lean();
      await workAll(cid);
      // the order the staff are sent in does not matter
      await next(cid, { staff: ids(staff, 4).reverse() }).expect(201);
      const moved: any[] = await m.UserLead.find({ campaign: cid, user: staff[1]._id, campaign_round: 2 }).lean();
      expect(moved.map((r) => String(r.contact)).sort()).toEqual(before.map((r) => String(r.contact)).sort());
    });

    it('leaving the staff out means the campaign\'s own people', async () => {
      const cid = await start(12, 3);
      await workAll(cid);
      const out = await next(cid);
      expect(out.status).toBe(201);
      expect(Object.keys(await perStaff(cid, 2)).sort()).toEqual(ids(staff, 3).sort());
    });

    it('bad staff are refused and the round does not change', async () => {
      const cid = await start(12, 3);
      await workAll(cid);
      const other = await makeStaff(2, B, 'o');
      const tl = await m.User.create({ first_name: 'T', last_name: 'L', email: 'tl@x.com', username: 'tl', password: 'x', password_text: 'x', branch: A, role: 'teamlead' });
      const bad: [string, any][] = [
        ['empty', []],
        ['not a list', 'abc'],
        ['not an id', ['abc']],
        ['another company', [String(other[0]._id)]],
        ['a team lead', [String(tl._id)]],
        ['too many', [...ids(staff), ...ids(await makeStaff(45, A, 'z'))]],
      ];
      for (const [label, value] of bad) {
        const res = await next(cid, { staff: value });
        expect([label, res.status]).toEqual([label, 400]);
      }
      expect((await m.Campaign.findById(cid).lean() as any).round).toBe(1);
      expect(await m.UserLead.countDocuments({ campaign: cid, campaign_round: 2 })).toBe(0);
    });

    it('the same person listed twice counts once', async () => {
      const cid = await start(12, 3);
      await workAll(cid);
      const who = String(staff[8]._id);
      const out = await next(cid, { staff: [who, who] });
      expect(out.status).toBe(201);
      expect(Object.keys(await perStaff(cid, 2))).toEqual([who]);
    });

    it('the campaign can go on until everyone in the company has had every lead, then it says so', async () => {
      // a company of just 4 employees
      await m.User.deleteMany({ _id: { $nin: staff.slice(0, 4).map((s) => s._id) } });
      const cid = await start(8, 2);
      expect((await call('adminA', 'get', `/campaigns/${cid}`)).body.can_next_round).toBe(true);
      await workAll(cid);
      await next(cid, { staff: ids(staff, 2) }).expect(201); // s0 and s1 swap
      await workAll(cid);
      expect((await call('adminA', 'get', `/campaigns/${cid}`)).body.can_next_round).toBe(true); // s2, s3 have had nothing
      await next(cid, { staff: ids(staff.slice(2, 4)) }).expect(201);
      await workAll(cid);
      // each lead went to only one of s2 / s3, so they swap
      await next(cid, { staff: ids(staff.slice(2, 4)) }).then((r) => expect(r.status).toBe(201));
      await workAll(cid);
      await next(cid, { staff: ids(staff.slice(2, 4)) }).then((r) => expect(r.status).toBe(409));
      const detail = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(detail.body.can_next_round).toBe(false);
      expect(detail.body.movable_leads).toBe(0);
      await noRepeats(cid);
    });

    it('hot campaigns keep handing out hot leads whoever is chosen', async () => {
      await fillHotPool(6);
      const cid = (await call('adminA', 'post', '/campaigns', { name: 'HotPeople', staff: ids(staff, 2), count: 6, lead_type: 'HOT' })).body._id;
      await workAll(cid);
      await next(cid, { staff: ids(staff.slice(2, 4)) }).expect(201);
      const second: any[] = await m.UserLead.find({ campaign: cid, campaign_round: 2 }).lean();
      expect(second.length).toBe(6);
      expect(second.every((r) => r.is_hot_lead === true)).toBe(true);
    });

    it('only admin and superadmin may start a round', async () => {
      const cid = await start(6, 2);
      for (const who of ['staffA', 'tlA']) {
        expect((await call(who, 'post', `/campaigns/${cid}/next-round`, { staff: ids(staff, 2) })).status).toBe(403);
      }
      expect((await call('adminB', 'post', `/campaigns/${cid}/next-round`, { staff: ids(staff, 2) })).status).toBe(404);
    });
  });

  describe('finishing by itself', () => {
    const start = async (leads: number, people: number) => {
      await fillPool(leads);
      return (await call('adminA', 'post', '/campaigns', { name: 'Auto', staff: ids(staff, people), count: leads })).body._id as string;
    };
    const workAll = (cid: string, status = 'RINGING') => m.UserLead.updateMany({ campaign: cid, status: 'FRESH' }, { $set: { status } });
    const next = (cid: string, body: any = {}) => call('adminA', 'post', '/campaigns/' + cid + '/next-round', body);
    const onlyTwoEmployees = () => m.User.deleteMany({ _id: { $nin: staff.slice(0, 2).map((s) => s._id) } });

    it('closes by itself on the round after which nobody has anything left to receive', async () => {
      await onlyTwoEmployees();
      const cid = await start(6, 2);
      await workAll(cid);
      const r2 = await next(cid);
      expect(r2.status).toBe(201);
      expect(r2.body.closed).toBe(true);
      expect(r2.body.message).toContain('campaign is now closed');

      const detail = (await call('adminA', 'get', '/campaigns/' + cid)).body;
      expect(detail.status).toBe('COMPLETED');
      expect(detail.closed_at).toBeTruthy();
      expect(detail.can_next_round).toBe(false);
      expect(detail.history).toHaveLength(1);
      expect(detail.history[0].moved).toBe(6);
    });

    it('a closed campaign refuses another round and another close', async () => {
      await onlyTwoEmployees();
      const cid = await start(4, 2);
      await workAll(cid);
      await next(cid);
      expect((await next(cid)).status).toBe(409);
      expect((await call('adminA', 'post', '/campaigns/' + cid + '/close')).status).toBe(409);
    });

    it('keeps going while anyone in the company still has not had some lead', async () => {
      await m.User.deleteMany({ _id: { $nin: staff.slice(0, 4).map((s) => s._id) } });
      const cid = await start(8, 2);
      await workAll(cid);
      const r2 = await next(cid, { staff: ids(staff, 2) });
      expect(r2.status).toBe(201);
      expect(r2.body.closed).toBe(false);
      expect((await call('adminA', 'get', '/campaigns/' + cid)).body.status).toBe('ACTIVE');
    });

    it('finished leads count as done: a mix of paid and moved leads also closes it', async () => {
      await onlyTwoEmployees();
      const cid = await start(6, 2);
      const rows = await m.UserLead.find({ campaign: cid }).sort({ _id: 1 });
      await m.UserLead.updateOne({ _id: rows[0]._id }, { $set: { status: 'PAYMENT_DONE' } });
      await m.UserLead.updateOne({ _id: rows[1]._id }, { $set: { status: 'DEAD' } });
      await workAll(cid);
      const r2 = await next(cid);
      expect(r2.body.closed).toBe(true);
      expect(r2.body.finished).toBe(2);
      expect((await call('adminA', 'get', '/campaigns/' + cid)).body.status).toBe('COMPLETED');
    });

    it('a round where some leads stay (status not chosen) does not close while those can still move', async () => {
      await onlyTwoEmployees();
      const cid = await start(6, 2);
      const rows = await m.UserLead.find({ campaign: cid }).sort({ _id: 1 });
      await m.UserLead.updateMany({ _id: { $in: rows.slice(0, 3).map((r) => r._id) } }, { $set: { status: 'RINGING' } });
      const r2 = await next(cid, { move_statuses: ['RINGING'] });
      expect(r2.status).toBe(201);
      expect(r2.body.closed).toBe(false); // the 3 untouched leads have only been held once
      expect((await call('adminA', 'get', '/campaigns/' + cid)).body.can_next_round).toBe(true);
    });

    it('closing by itself leaves the leads and report as they were', async () => {
      await onlyTwoEmployees();
      const cid = await start(4, 2);
      await workAll(cid);
      await next(cid);
      expect(await m.UserLead.countDocuments({ campaign: cid })).toBe(8);
      expect(await m.UserLead.countDocuments({ campaign: cid, campaign_round: 2 })).toBe(4);
    });
  });

  describe('planRound (who takes which lead)', () => {
    const lead = (key: string, batch: number, held: string[] = []) => ({ key, batch, held: new Set(held) });
    const counts = (plan: { assign: Map<string, string> }) => {
      const c: Record<string, number> = {};
      plan.assign.forEach((who) => (c[who] = (c[who] ?? 0) + 1));
      return c;
    };

    it('nobody gets a lead they already held', () => {
      const leads = Array.from({ length: 20 }, (_, i) => lead('l' + i, i % 4, ['s' + (i % 4)]));
      const plan = planRound(leads, ['s0', 's1', 's2', 's3'], 2);
      leads.forEach((l) => expect(l.held.has(plan.assign.get(l.key)!)).toBe(false));
      expect(plan.unplaced).toEqual([]);
    });

    it('the same people give the plain circle', () => {
      const staffIds = ['a', 'b', 'c', 'd'];
      const leads = Array.from({ length: 8 }, (_, i) => lead('l' + i, i % 4, [staffIds[i % 4]]));
      const plan = planRound(leads, staffIds, 2);
      leads.forEach((l) => expect(plan.assign.get(l.key)).toBe(staffIds[(l.batch + 1) % 4]));
    });

    it('a smaller group still gets an even share', () => {
      const leads = Array.from({ length: 30 }, (_, i) => lead('l' + i, i % 10));
      const plan = planRound(leads, ['a', 'b', 'c'], 2);
      expect(Object.values(counts(plan))).toEqual([10, 10, 10]);
    });

    it('uneven numbers differ by at most one', () => {
      const leads = Array.from({ length: 31 }, (_, i) => lead('l' + i, i % 7));
      const sizes = Object.values(counts(planRound(leads, ['a', 'b', 'c', 'd', 'e'], 3)));
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    });

    it('a lead with only one possible taker is never crowded out', () => {
      const leads = [
        lead('forced1', 0, ['b']),
        lead('forced2', 1, ['b']),
        lead('free1', 2),
        lead('free2', 3),
      ];
      const plan = planRound(leads, ['a', 'b'], 2);
      expect(plan.assign.get('forced1')).toBe('a');
      expect(plan.assign.get('forced2')).toBe('a');
      expect(plan.assign.get('free1')).toBe('b');
      expect(plan.assign.get('free2')).toBe('b');
    });

    it('a lead everyone has held is returned unplaced', () => {
      const plan = planRound([lead('x', 0, ['a', 'b']), lead('y', 1, ['a'])], ['a', 'b'], 2);
      expect(plan.unplaced).toEqual(['x']);
      expect(plan.assign.get('y')).toBe('b');
    });

    it('no staff at all places nothing', () => {
      const plan = planRound([lead('x', 0)], [], 2);
      expect(plan.unplaced).toEqual(['x']);
      expect(plan.assign.size).toBe(0);
    });

    it('is repeatable: the same input gives the same answer', () => {
      const leads = Array.from({ length: 25 }, (_, i) => lead('l' + i, i % 5, i % 2 ? ['a'] : []));
      const one = planRound(leads, ['a', 'b', 'c'], 2);
      const two = planRound(leads, ['a', 'b', 'c'], 2);
      expect([...one.assign.entries()]).toEqual([...two.assign.entries()]);
    });

    it('the biggest campaign (10,000 leads, 50 people) is planned in a moment', () => {
      const staffIds = Array.from({ length: 50 }, (_, i) => 's' + i);
      const leads = Array.from({ length: 10000 }, (_, i) => lead('l' + i, i % 50, [staffIds[i % 50]]));
      const started = Date.now();
      const plan = planRound(leads, staffIds, 2);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(plan.unplaced).toEqual([]);
      expect(new Set(Object.values(counts(plan))).size).toBe(1); // 200 each
      // and with a third of the people away
      const some = staffIds.filter((_, i) => i % 3 !== 0);
      const started2 = Date.now();
      const part = planRound(leads, some, 2);
      expect(Date.now() - started2).toBeLessThan(5000);
      const sizes = Object.values(counts(part));
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    });

    it('random situations: never a repeat, every lead placed or reported, a level load when it can be', () => {
      let seed = 12345;
      const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
      for (let trial = 0; trial < 200; trial++) {
        const people = 1 + Math.floor(random() * 8);
        const everyone = Array.from({ length: 9 }, (_, i) => 'p' + i);
        const chosen = everyone.filter(() => random() < people / 9).slice(0, people);
        if (chosen.length === 0) continue;
        const total = 1 + Math.floor(random() * 40);
        const leads = Array.from({ length: total }, (_, i) =>
          lead('l' + i, Math.floor(random() * 9), everyone.filter(() => random() < 0.3)),
        );
        const plan = planRound(leads, chosen, 2 + Math.floor(random() * 5));
        expect(plan.assign.size + plan.unplaced.length).toBe(total);
        leads.forEach((l) => {
          const who = plan.assign.get(l.key);
          if (who) {
            expect(chosen).toContain(who);
            expect(l.held.has(who)).toBe(false);
          } else {
            expect(chosen.every((c) => l.held.has(c))).toBe(true); // only when nobody chosen could take it
          }
        });
        // when nothing is held, the load must be level
        const free = leads.map((l) => lead(l.key, l.batch));
        const level = Object.values(counts(planRound(free, chosen, 2)));
        expect(Math.max(...level) - Math.min(...level)).toBeLessThanOrEqual(1);
      }
    });

    it('every full circle of 10 people over 10 rounds is exact', () => {
      const staffIds = Array.from({ length: 10 }, (_, i) => 's' + i);
      const leads = Array.from({ length: 100 }, (_, i) => lead('l' + i, i % 10, [staffIds[i % 10]]));
      for (let round = 2; round <= 10; round++) {
        const plan = planRound(leads, staffIds, round);
        expect(plan.unplaced).toEqual([]);
        expect(Object.values(counts(plan))).toEqual(new Array(10).fill(10));
        leads.forEach((l) => l.held.add(plan.assign.get(l.key)!));
      }
      leads.forEach((l) => expect(l.held.size).toBe(10));
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
      expect(res.body).toMatchObject({ name: 'Detail', round: 1, total_leads: 12, finished: 1, untouched: 10, can_next_round: true, status: 'ACTIVE' });
      expect(res.body.statuses).toEqual({ FRESH: 10, PAYMENT_DONE: 1, RINGING: 1 });
      expect(res.body.staff.length).toBe(3);
      expect(res.body.staff[0]).toMatchObject({ username: 's0', holding: 4, untouched: 2, assigned_total: 4, worked_total: 2 });

      await workEverything(cid);
      await call('adminA', 'post', `/campaigns/${cid}/next-round`).expect(201);
      await workEverything(cid);
      await call('adminA', 'post', `/campaigns/${cid}/next-round`).expect(201);
      const last = await call('adminA', 'get', `/campaigns/${cid}`);
      expect(last.body.can_next_round).toBe(true); // 7 more people in the company have not had them
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
      expect(res.body[0]).toMatchObject({ round: 1, total_leads: 3, created_by: "adminA" });
    });

    it('staff list marks who logged in today', async () => {
      await m.Attendance.deleteMany({});
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
