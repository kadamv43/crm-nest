import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AttendanceService } from 'src/attendance/attendance.service';
import { Role } from 'src/auth/roles.enum';
import { attendanceDate } from 'src/common/time.util';
import { assignMany } from 'src/contacts/assignment.helper';
import { ContactsService } from 'src/contacts/contacts.service';
import { LeadActivityService } from 'src/contacts/lead-activity.service';
import { HotLead } from 'src/hot-leads/hot-lead.schema';
import { Lead } from 'src/leads/lead.schema';
import { UserLead } from 'src/user-leads/user-lead.schema';
import { User } from 'src/users/user.schema';
import { Campaign, CampaignLead } from './campaign.schema';
import {
  batchOf,
  CAMPAIGN_STATUSES,
  DEFAULT_MOVE_STATUSES,
  FINAL_STATUSES,
  holderIndex,
  planRound,
  MAX_CAMPAIGN_LEADS,
  MAX_CAMPAIGN_STAFF,
} from './rotation.util';

export interface CampaignContext {
  branch: string;
  actorId: string;
  actorName?: string;
}

export interface CreateCampaignInput {
  name?: any;
  staff?: any;
  lead_ids?: any;
  leads?: any;
  count?: any;
  move_statuses?: any;
  lead_type?: any;
}

export type LeadType = 'NORMAL' | 'HOT';

const oid = (id: any) => new Types.ObjectId(String(id));
const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

@Injectable()
export class CampaignsService implements OnModuleInit {
  constructor(
    @InjectModel(Campaign.name) private readonly campaigns: Model<Campaign>,
    @InjectModel(CampaignLead.name) private readonly campaignLeads: Model<CampaignLead>,
    @InjectModel(Lead.name) private readonly normalPool: Model<Lead>,
    @InjectModel(HotLead.name) private readonly hotPool: Model<HotLead>,
    @InjectModel(UserLead.name) private readonly userLeads: Model<UserLead>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly contacts: ContactsService,
    private readonly activity: LeadActivityService,
    private readonly attendance: AttendanceService,
  ) {}

  async onModuleInit() {
    // the unique indexes are what keeps two campaigns from sharing a name
    // or a lead from being in a campaign twice
    try {
      await this.campaigns.createIndexes();
      await this.campaignLeads.createIndexes();
    } catch {
      /* indexes are also built lazily by mongoose */
    }
  }

  /** The company's staff, with who logged in today (so the screen can pre-select them). */
  async staffList(branch: string) {
    const [staff, present] = await Promise.all([
      this.users
        .find({ branch: oid(branch), role: Role.Employee })
        .select('first_name last_name username')
        .sort({ username: 1 })
        .lean()
        .exec(),
      this.attendance.loggedInUserIds(attendanceDate(), branch),
    ]);
    const here = new Set(present);
    return staff.map((u: any) => ({
      _id: u._id,
      username: u.username,
      name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim(),
      present: here.has(String(u._id)),
    }));
  }

  private cleanName(name: any): string {
    const text = typeof name === 'string' ? name.trim() : '';
    if (!text) throw new BadRequestException('Please give the campaign a name');
    if (text.length > 80) {
      throw new BadRequestException('The name can be at most 80 characters');
    }
    return text;
  }

  /** NORMAL or HOT; nothing given means NORMAL. */
  private cleanLeadType(value: any): LeadType {
    if (value === undefined || value === null || value === '') return 'NORMAL';
    const type = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (type !== 'NORMAL' && type !== 'HOT') {
      throw new BadRequestException('Lead type must be Normal or Hot');
    }
    return type;
  }

  /** The waiting pool a campaign of this type takes its leads from. */
  private poolOf(type: LeadType): Model<any> {
    return (type === 'HOT' ? this.hotPool : this.normalPool) as Model<any>;
  }

  /** Which statuses move on in a round; nothing given means `fallback`. */
  private cleanMoveStatuses(value: any, fallback: string[] = DEFAULT_MOVE_STATUSES): string[] {
    if (value === undefined || value === null || value === '') {
      return [...fallback];
    }
    let list = value;
    if (typeof value === 'string') {
      try {
        list = JSON.parse(value);
      } catch {
        throw new BadRequestException('The chosen statuses are invalid');
      }
    }
    if (!Array.isArray(list)) {
      throw new BadRequestException('The chosen statuses are invalid');
    }
    const chosen = [...new Set(list.map((s) => String(s)))];
    const unknown = chosen.filter((s) => !CAMPAIGN_STATUSES.includes(s));
    if (unknown.length) {
      throw new BadRequestException(`Unknown status: ${unknown.slice(0, 3).join(', ')}`);
    }
    if (chosen.length === 0) {
      throw new BadRequestException('Choose at least one status to move to the next round');
    }
    return chosen;
  }

  private async cleanStaff(branch: string, staff: any, minimum = 2): Promise<string[]> {
    if (!Array.isArray(staff)) {
      throw new BadRequestException('Please choose the staff');
    }
    const ids = [...new Set(staff.map((s) => String(s)))];
    if (ids.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException('One of the staff ids is not valid');
    }
    if (ids.length < minimum) {
      throw new BadRequestException(
        minimum === 1
          ? 'Choose at least one staff member for this round'
          : `Choose at least ${minimum} staff to rotate between`,
      );
    }
    if (ids.length > MAX_CAMPAIGN_STAFF) {
      throw new BadRequestException(`At most ${MAX_CAMPAIGN_STAFF} staff per campaign`);
    }
    const found = await this.users.countDocuments({
      _id: { $in: ids.map(oid) },
      branch: oid(branch),
      role: Role.Employee,
    });
    if (found !== ids.length) {
      throw new BadRequestException(
        'Every chosen person must be a staff member of this company',
      );
    }
    return ids;
  }

  /** The first round only goes to people who are logged in today. */
  private async requireLoggedIn(branch: string, staff: string[]) {
    const here = new Set(await this.attendance.loggedInUserIds(attendanceDate(), branch));
    const away = staff.filter((id) => !here.has(id));
    if (away.length === 0) return;
    const people: any[] = await this.users
      .find({ _id: { $in: away.map(oid) } })
      .select('first_name last_name username')
      .lean()
      .exec();
    const names = people.map((p) => p.username || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim());
    throw new BadRequestException(
      `Not logged in today: ${names.join(', ')}. Leads can only be given to people who are logged in. Remove them and try again.`,
    );
  }

  /** Takes the leads out of the pool; a lead another admin took meanwhile is skipped. */
  private async claimFromPool(branch: string, input: CreateCampaignInput, type: LeadType) {
    const pool = this.poolOf(type);
    const hasIds = input.lead_ids !== undefined && input.lead_ids !== null;
    const hasCount = input.count !== undefined && input.count !== null && input.count !== '';
    const hasUpload = input.leads !== undefined && input.leads !== null;
    if ([hasIds, hasCount, hasUpload].filter(Boolean).length !== 1) {
      throw new BadRequestException(
        'Choose leads from the pool or upload an Excel file',
      );
    }

    if (hasUpload) {
      return this.claimUploaded(branch, input.leads, type);
    }

    let wanted: any[];
    let requested: number;
    if (hasIds) {
      if (!Array.isArray(input.lead_ids) || input.lead_ids.length === 0) {
        throw new BadRequestException('Pick at least one lead');
      }
      const ids = [...new Set(input.lead_ids.map((i: any) => String(i)))] as string[];
      if (ids.some((i) => !Types.ObjectId.isValid(i))) {
        throw new BadRequestException('One of the lead ids is not valid');
      }
      requested = ids.length;
      if (ids.length > MAX_CAMPAIGN_LEADS) {
        throw new BadRequestException(`At most ${MAX_CAMPAIGN_LEADS} leads per campaign`);
      }
      wanted = await pool
        .find({ _id: { $in: ids.map(oid) }, branch: oid(branch) })
        .select('_id')
        .lean()
        .exec();
    } else {
      const n = Number(input.count);
      if (!Number.isInteger(n) || n < 1 || n > MAX_CAMPAIGN_LEADS) {
        throw new BadRequestException(
          `The number of leads must be a whole number from 1 to ${MAX_CAMPAIGN_LEADS}`,
        );
      }
      requested = n;
      wanted = await pool
        .find({ branch: oid(branch) })
        .sort({ created_at: 1, _id: 1 })
        .limit(n)
        .select('_id')
        .lean()
        .exec();
    }

    const claimed: any[] = [];
    for (const group of chunk(wanted, 50)) {
      const rows = await Promise.all(
        group.map((w: any) =>
          pool.findOneAndDelete({ _id: w._id, branch: oid(branch) }).lean().exec(),
        ),
      );
      rows.forEach((r) => r && claimed.push(r));
    }
    return { claimed, requested };
  }

  /** Resolves uploaded contacts and removes matching rows from the waiting pool. */
  private async claimUploaded(branch: string, rows: any, type: LeadType) {
    const pool = this.poolOf(type);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('The Excel file has no lead rows');
    }
    if (rows.length > MAX_CAMPAIGN_LEADS) {
      throw new BadRequestException(`At most ${MAX_CAMPAIGN_LEADS} leads per campaign`);
    }

    const leads = rows.map((row) => {
      const firstName = String(row?.first_name ?? '').trim();
      const lastName = String(row?.last_name ?? '').trim();
      const name = [firstName, lastName].filter(Boolean).join(' ');
      return { ...row, name: name || String(row?.name ?? '').trim() };
    });
    const resolved = await this.contacts.resolve(branch, leads);
    const claimed: any[] = [];

    for (const group of chunk(resolved.rows, 50)) {
      const waitingRows = await Promise.all(
        group.map((row: any) =>
          pool
            .findOneAndDelete({ branch: oid(branch), contact: row.contact._id })
            .lean()
            .exec(),
        ),
      );

      group.forEach((row: any, index) => {
        const waiting: any = waitingRows[index];
        const uploadedName = [
          String(row.row?.first_name ?? '').trim(),
          String(row.row?.last_name ?? '').trim(),
        ]
          .filter(Boolean)
          .join(' ');
        claimed.push({
          ...(waiting ?? {}),
          contact: row.contact._id,
          mobile: row.mobile,
          name: uploadedName || waiting?.name || row.contact.name,
          city: row.row?.city || waiting?.city || row.contact.city,
          branch: oid(branch),
        });
      });
    }

    return { claimed, requested: rows.length };
  }

  async create(ctx: CampaignContext, input: CreateCampaignInput) {
    const name = this.cleanName(input?.name);
    const staff = await this.cleanStaff(ctx.branch, input?.staff);
    const leadType = this.cleanLeadType(input?.lead_type);
    await this.requireLoggedIn(ctx.branch, staff);

    let campaign: any;
    try {
      campaign = await this.campaigns.create({
        branch: oid(ctx.branch),
        name,
        staff: staff.map(oid),
        round: 1,
        created_by: oid(ctx.actorId),
        lead_type: leadType,
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new ConflictException('A campaign with this name already exists');
      }
      throw e;
    }

    let claimed: any[] = [];
    try {
      const taken = await this.claimFromPool(ctx.branch, input, leadType);
      claimed = taken.claimed;
      if (claimed.length === 0) {
        throw new BadRequestException(
          input.leads !== undefined && input.leads !== null
            ? 'The Excel file has no valid mobile numbers'
            : leadType === 'HOT'
              ? 'There are no hot leads in the pool to take'
              : 'There are no leads in the pool to take',
        );
      }

      await this.campaignLeads.insertMany(
        claimed.map((row, i) => ({
          campaign: campaign._id,
          branch: oid(ctx.branch),
          contact: row.contact,
          mobile: row.mobile,
          name: row.name,
          city: row.city,
          batch: batchOf(i, staff.length),
        })),
      );
      await this.campaigns.updateOne(
        { _id: campaign._id },
        { $set: { total_leads: claimed.length } },
      );

      await assignMany(
        this.userLeads as any,
        this.contacts,
        this.activity,
        'LEAD',
        ctx,
        claimed.map((row, i) => ({
          contact: row.contact,
          mobile: row.mobile,
          name: row.name,
          city: row.city,
          user: staff[holderIndex(batchOf(i, staff.length), 1, staff.length)],
          is_hot_lead: leadType === 'HOT',
          campaign: campaign._id,
          campaign_round: 1,
          assigned_by: ctx.actorName,
        })),
      );

      return {
        _id: campaign._id,
        name,
        leads: claimed.length,
        skipped: taken.requested - claimed.length,
        staff: staff.length,
        message: `${claimed.length} leads handed to ${staff.length} staff`,
      };
    } catch (e) {
      // undo everything so no lead is lost: the leads go back to the pool
      await this.undoCreate(campaign._id, claimed, leadType);
      throw e;
    }
  }

  private async undoCreate(campaignId: any, claimed: any[], type: LeadType) {
    try {
      await this.userLeads.deleteMany({ campaign: campaignId });
      await this.campaignLeads.deleteMany({ campaign: campaignId });
      await this.campaigns.deleteOne({ _id: campaignId });
      if (claimed.length) {
        await this.poolOf(type).insertMany(claimed, { ordered: false });
      }
    } catch {
      /* best effort; the original error is what the caller sees */
    }
  }

  private async load(id: string, branch: string): Promise<any> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Campaign not found');
    }
    const campaign = await this.campaigns
      .findOne({ _id: oid(id), branch: oid(branch) })
      .lean()
      .exec();
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /** Newest row of every lead of the campaign (who has it now, and its status). */
  private latestRows(campaignId: any) {
    return this.userLeads
      .aggregate([
        { $match: { campaign: oid(campaignId) } },
        { $sort: { created_at: -1, _id: -1 } },
        {
          $group: {
            _id: '$contact',
            row: { $first: '$_id' },
            user: { $first: '$user' },
            status: { $first: '$status' },
            round: { $first: '$campaign_round' },
          },
        },
      ])
      .exec();
  }

  async list(branch: string) {
    const rows = await this.campaigns
      .find({ branch: oid(branch) })
      .sort({ created_at: -1 })
      .limit(200)
      .lean()
      .exec();
    const [makers, assignmentCounts] = await Promise.all([
      this.users
        .find({ _id: { $in: rows.map((r: any) => r.created_by).filter(Boolean) } })
        .select('username')
        .lean()
        .exec(),
      rows.length
        ? this.userLeads
            .aggregate([
              { $match: { campaign: { $in: rows.map((r: any) => r._id) } } },
              { $group: { _id: '$campaign', count: { $sum: 1 } } },
            ])
            .exec()
        : Promise.resolve([]),
    ]);
    const name = new Map(makers.map((u: any) => [String(u._id), u.username]));
    const assigned = new Map(
      assignmentCounts.map((r: any) => [String(r._id), r.count]),
    );
    return rows.map((r: any) => ({
      _id: r._id,
      name: r.name,
      status: r.status,
      round: r.round,
      staff: r.staff.length,
      total_leads: r.total_leads,
      total_assignments: assigned.get(String(r._id)) ?? 0,
      lead_type: r.lead_type ?? 'NORMAL',
      created_by: name.get(String(r.created_by)),
      created_at: r.created_at,
    }));
  }

  async options(branch: string) {
    return this.campaigns
      .find({ branch: oid(branch) })
      .select('_id name')
      .sort({ created_at: -1 })
      .lean()
      .exec();
  }

  async detail(id: string, branch: string) {
    const campaign = await this.load(id, branch);
    const [latest, staffUsers, totals, doneCount, holderSets] = await Promise.all([
      this.latestRows(campaign._id),
      this.users
        .find({ _id: { $in: campaign.staff } })
        .select('first_name last_name username')
        .lean()
        .exec(),
      // per staff member: rows handed to them / worked by them, over all rounds
      this.userLeads
        .aggregate([
          { $match: { campaign: campaign._id } },
          {
            $group: {
              _id: '$user',
              assigned: { $sum: 1 },
              worked: { $sum: { $cond: [{ $ne: ['$status', 'FRESH'] }, 1, 0] } },
            },
          },
        ])
        .exec(),
      this.campaignLeads.countDocuments({ campaign: campaign._id, done: true }),
      this.holdersByContact(campaign._id),
    ]);
    const holders = new Map<string, number>(
      [...holderSets.entries()].map(([contact, set]) => [contact, set.size]),
    );

    const byUser = new Map(staffUsers.map((u: any) => [String(u._id), u]));
    const totalsBy = new Map(totals.map((t: any) => [String(t._id), t]));
    const holding = new Map<string, { holding: number; untouched: number }>();
    const statuses: Record<string, number> = {};
    let untouched = 0;
    let finished = 0;
    for (const row of latest) {
      statuses[row.status] = (statuses[row.status] ?? 0) + 1;
      const final = FINAL_STATUSES.includes(row.status);
      if (final) finished++;
      const slot = holding.get(String(row.user)) ?? { holding: 0, untouched: 0 };
      slot.holding++;
      if (row.status === 'FRESH') {
        slot.untouched++;
        untouched++;
      }
      holding.set(String(row.user), slot);
    }

    const movable = await this.countMovable(campaign, latest, holders);

    const history = campaign.history ?? [];
    return {
      _id: campaign._id,
      name: campaign.name,
      status: campaign.status,
      round: campaign.round,
      total_leads: campaign.total_leads,
      lead_type: campaign.lead_type ?? 'NORMAL',
      // what the next-round window starts with: the last choice made
      move_statuses: this.lastStatuses(campaign),
      history: history.map((h: any) => ({
        round: h.round,
        move_statuses: h.move_statuses,
        staff: h.staff_count,
        moved: h.moved,
        stayed: h.stayed,
        no_candidate: h.no_candidate,
        finished: h.finished,
        at: h.at,
      })),
      created_at: campaign.created_at,
      closed_at: campaign.closed_at,
      finished: Math.max(finished, doneCount),
      untouched,
      movable_leads: movable,
      statuses,
      can_next_round: campaign.status === 'ACTIVE' && movable > 0,
      staff: campaign.staff.map((sid: any) => {
        const u: any = byUser.get(String(sid));
        const h = holding.get(String(sid)) ?? { holding: 0, untouched: 0 };
        const t: any = totalsBy.get(String(sid)) ?? { assigned: 0, worked: 0 };
        return {
          _id: sid,
          username: u?.username ?? '(removed)',
          name: u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '',
          holding: h.holding,
          untouched: h.untouched,
          assigned_total: t.assigned,
          worked_total: t.worked,
        };
      }),
    };
  }

  /** The statuses the next-round window starts with: the last choice, else the old campaign setting, else the default. */
  private lastStatuses(campaign: any): string[] {
    const history = campaign.history ?? [];
    const last = history[history.length - 1]?.move_statuses;
    if (Array.isArray(last) && last.length) return last;
    if (campaign.move_statuses?.length) return campaign.move_statuses;
    return [...DEFAULT_MOVE_STATUSES];
  }

  /** contact -> everybody who has ever held it in this campaign */
  private async holdersByContact(campaignId: any): Promise<Map<string, Set<string>>> {
    const rows = await this.userLeads
      .aggregate([
        { $match: { campaign: oid(campaignId) } },
        { $group: { _id: '$contact', users: { $addToSet: '$user' } } },
      ])
      .exec();
    return new Map(
      rows.map((r: any) => [String(r._id), new Set<string>(r.users.map((u: any) => String(u)))]),
    );
  }

  /**
   * Moves leads on to new people. Always started by an admin pressing the
   * button; nothing starts a round on its own. For each round the admin says
   * which statuses move and which staff take part; leaving them out means
   * "the same staff as the campaign has" and "the statuses used last time".
   */
  async nextRound(
    id: string,
    ctx: CampaignContext,
    input: { staff?: any; move_statuses?: any } = {},
  ) {
    const campaign = await this.load(id, ctx.branch);
    if (campaign.status !== 'ACTIVE') {
      throw new ConflictException('This campaign is closed');
    }

    let chosen: string[];
    if (input?.staff === undefined || input?.staff === null) {
      chosen = campaign.staff.map((s: any) => String(s));
      const stillHere = await this.users.countDocuments({
        _id: { $in: campaign.staff },
        branch: oid(ctx.branch),
      });
      if (stillHere !== chosen.length) {
        throw new ConflictException(
          'One of the staff in this campaign is no longer in the company',
        );
      }
    } else {
      chosen = await this.cleanStaff(ctx.branch, input.staff, 1);
    }
    const statuses = this.cleanMoveStatuses(input?.move_statuses, this.lastStatuses(campaign));

    // only one click can win the move from round r to r+1
    const nextRound = campaign.round + 1;
    const claimed = await this.campaigns
      .findOneAndUpdate(
        { _id: campaign._id, status: 'ACTIVE', round: campaign.round },
        { $set: { round: nextRound, updated_at: new Date() } },
        { new: true },
      )
      .lean()
      .exec();
    if (!claimed) {
      throw new ConflictException(
        'The round was just changed by someone else. Refresh and look again.',
      );
    }

    try {
      return await this.moveLeads(campaign, nextRound, ctx, chosen, statuses);
    } catch (e) {
      // put the round back so the same click can be tried again (already
      // moved leads are skipped the second time)
      await this.campaigns.updateOne(
        { _id: campaign._id, round: nextRound },
        { $set: { round: campaign.round } },
      );
      throw e;
    }
  }

  private async moveLeads(
    campaign: any,
    nextRound: number,
    ctx: CampaignContext,
    chosen: string[],
    statuses: string[],
  ) {
    const latest = await this.latestRows(campaign._id);
    const latestBy = new Map(latest.map((l: any) => [String(l._id), l]));
    const held = await this.holdersByContact(campaign._id);

    const open = await this.campaignLeads
      .find({ campaign: campaign._id, done: false })
      .lean()
      .exec();

    const moves = new Set<string>(statuses);
    const finishedIds: any[] = [];
    let untouchedRetained = 0;
    let alreadyMoved = 0;
    let stayed = 0;
    const movers: any[] = [];

    for (const lead of open as any[]) {
      const row: any = latestBy.get(String(lead.contact));
      if (row && (row.round ?? 0) >= nextRound) {
        alreadyMoved++; // a retry after a failed attempt
        continue;
      }
      if (row && !moves.has(row.status)) {
        // not one of the chosen statuses: it stays with its holder. A
        // finished lead is also marked done so it is not looked at again.
        if (FINAL_STATUSES.includes(row.status)) finishedIds.push(lead._id);
        else stayed++;
        continue;
      }
      if (row?.status === 'FRESH') untouchedRetained++;
      movers.push(lead);
    }

    // "next in line" follows the order the people joined the campaign
    const known = campaign.staff.map((s: any) => String(s));
    const ordered = [
      ...known.filter((s: string) => chosen.includes(s)),
      ...chosen.filter((s) => !known.includes(s)),
    ];
    const plan = planRound(
      movers.map((lead) => ({
        key: String(lead.contact),
        batch: lead.batch,
        held: held.get(String(lead.contact)) ?? new Set<string>(),
      })),
      ordered,
      nextRound,
    );

    const items: Record<string, any>[] = [];
    for (const lead of movers) {
      const who = plan.assign.get(String(lead.contact));
      if (!who) continue;
      // Keep the previous holder's row and add a new fresh one for this round.
      items.push({
        contact: lead.contact,
        mobile: lead.mobile,
        name: lead.name,
        city: lead.city,
        user: who,
        is_hot_lead: campaign.lead_type === 'HOT',
        campaign: campaign._id,
        campaign_round: nextRound,
        assigned_by: ctx.actorName,
      });
    }
    const noCandidate = plan.unplaced.length;

    if (items.length === 0 && alreadyMoved === 0) {
      const parts = [];
      if (stayed) parts.push(`${stayed} not in the chosen statuses`);
      if (noCandidate) parts.push(`${noCandidate} already had by everyone chosen`);
      if (finishedIds.length) parts.push(`${finishedIds.length} finished`);
      throw new ConflictException(
        `No lead can move this round${parts.length ? ': ' + parts.join(', ') : ''}. Change the statuses or the staff.`,
      );
    }

    if (finishedIds.length) {
      await this.campaignLeads.updateMany(
        { _id: { $in: finishedIds } },
        { $set: { done: true } },
      );
    }
    await assignMany(
      this.userLeads as any,
      this.contacts,
      this.activity,
      'LEAD',
      ctx,
      items,
    );

    const moved = items.length + alreadyMoved;
    await this.campaigns.updateOne(
      { _id: campaign._id },
      {
        $addToSet: { staff: { $each: ordered.map(oid) } },
        $push: {
          history: {
            round: nextRound,
            move_statuses: statuses,
            staff_count: ordered.length,
            moved,
            stayed,
            no_candidate: noCandidate,
            finished: finishedIds.length,
            at: new Date(),
          },
        },
      },
    );

    const closed = await this.closeIfExhausted(campaign);

    return {
      round: nextRound,
      closed,
      moved,
      finished: finishedIds.length,
      stayed,
      no_candidate: noCandidate,
      untouched_retained: untouchedRetained,
      message:
        `Round ${nextRound}: ${moved} leads moved on, ${finishedIds.length} finished` +
        (stayed ? `, ${stayed} stayed (status not chosen)` : '') +
        (noCandidate ? `, ${noCandidate} stayed (everyone chosen already had them)` : '') +
        (closed ? '. Nothing can move any further, so the campaign is now closed' : ''),
    };
  }

  /** A lead can still move while it is not finished and someone in the company has not held it yet. */
  private async countMovable(
    campaign: any,
    latest: any[],
    holders: Map<string, number>,
  ): Promise<number> {
    const employees = await this.users.countDocuments({
      branch: campaign.branch,
      role: Role.Employee,
    });
    return latest.filter(
      (row: any) =>
        !FINAL_STATUSES.includes(row.status) &&
        (holders.get(String(row._id)) ?? 0) < employees,
    ).length;
  }

  /** Closes the campaign once no lead is able to move any further. */
  private async closeIfExhausted(campaign: any): Promise<boolean> {
    const [latest, holderSets] = await Promise.all([
      this.latestRows(campaign._id),
      this.holdersByContact(campaign._id),
    ]);
    const holders = new Map<string, number>(
      [...holderSets.entries()].map(([contact, set]) => [contact, set.size]),
    );
    if ((await this.countMovable(campaign, latest, holders)) > 0) return false;
    const res = await this.campaigns.updateOne(
      { _id: campaign._id, status: 'ACTIVE' },
      { $set: { status: 'COMPLETED', closed_at: new Date() } },
    );
    return res.modifiedCount > 0;
  }

  async close(id: string, branch: string) {
    const campaign = await this.load(id, branch);
    if (campaign.status === 'COMPLETED') {
      throw new ConflictException('This campaign is already closed');
    }
    await this.campaigns.updateOne(
      { _id: campaign._id, status: 'ACTIVE' },
      { $set: { status: 'COMPLETED', closed_at: new Date() } },
    );
    return { message: 'Campaign closed', _id: campaign._id };
  }
}
