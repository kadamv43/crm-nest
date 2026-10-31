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
import { Lead } from 'src/leads/lead.schema';
import { UserLead } from 'src/user-leads/user-lead.schema';
import { User } from 'src/users/user.schema';
import { Campaign, CampaignLead } from './campaign.schema';
import {
  batchOf,
  FINAL_STATUSES,
  holderIndex,
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
  count?: any;
}

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
    @InjectModel(Lead.name) private readonly pool: Model<Lead>,
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

  private async cleanStaff(branch: string, staff: any): Promise<string[]> {
    if (!Array.isArray(staff)) {
      throw new BadRequestException('Please choose the staff for the campaign');
    }
    const ids = [...new Set(staff.map((s) => String(s)))];
    if (ids.some((id) => !Types.ObjectId.isValid(id))) {
      throw new BadRequestException('One of the staff ids is not valid');
    }
    if (ids.length < 2) {
      throw new BadRequestException('Choose at least 2 staff to rotate between');
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

  /** Takes the leads out of the pool; a lead another admin took meanwhile is skipped. */
  private async claimFromPool(branch: string, input: CreateCampaignInput) {
    const hasIds = input.lead_ids !== undefined && input.lead_ids !== null;
    const hasCount = input.count !== undefined && input.count !== null && input.count !== '';
    if (hasIds === hasCount) {
      throw new BadRequestException(
        'Choose the leads: either pick them, or say how many to take',
      );
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
      wanted = await this.pool
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
      wanted = await this.pool
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
          this.pool.findOneAndDelete({ _id: w._id, branch: oid(branch) }).lean().exec(),
        ),
      );
      rows.forEach((r) => r && claimed.push(r));
    }
    return { claimed, requested };
  }

  async create(ctx: CampaignContext, input: CreateCampaignInput) {
    const name = this.cleanName(input?.name);
    const staff = await this.cleanStaff(ctx.branch, input?.staff);

    let campaign: any;
    try {
      campaign = await this.campaigns.create({
        branch: oid(ctx.branch),
        name,
        staff: staff.map(oid),
        round: 1,
        created_by: oid(ctx.actorId),
      });
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new ConflictException('A campaign with this name already exists');
      }
      throw e;
    }

    let claimed: any[] = [];
    try {
      const taken = await this.claimFromPool(ctx.branch, input);
      claimed = taken.claimed;
      if (claimed.length === 0) {
        throw new BadRequestException('There are no leads in the pool to take');
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
      await this.undoCreate(campaign._id, claimed);
      throw e;
    }
  }

  private async undoCreate(campaignId: any, claimed: any[]) {
    try {
      await this.userLeads.deleteMany({ campaign: campaignId });
      await this.campaignLeads.deleteMany({ campaign: campaignId });
      await this.campaigns.deleteOne({ _id: campaignId });
      if (claimed.length) {
        await this.pool.insertMany(claimed, { ordered: false });
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
    const makers = await this.users
      .find({ _id: { $in: rows.map((r: any) => r.created_by).filter(Boolean) } })
      .select('username')
      .lean()
      .exec();
    const name = new Map(makers.map((u: any) => [String(u._id), u.username]));
    return rows.map((r: any) => ({
      _id: r._id,
      name: r.name,
      status: r.status,
      round: r.round,
      rounds: r.staff.length,
      staff: r.staff.length,
      total_leads: r.total_leads,
      created_by: name.get(String(r.created_by)),
      created_at: r.created_at,
    }));
  }

  async detail(id: string, branch: string) {
    const campaign = await this.load(id, branch);
    const [latest, staffUsers, totals, doneCount] = await Promise.all([
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
    ]);

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

    const rounds = campaign.staff.length;
    return {
      _id: campaign._id,
      name: campaign.name,
      status: campaign.status,
      round: campaign.round,
      rounds,
      total_leads: campaign.total_leads,
      created_at: campaign.created_at,
      closed_at: campaign.closed_at,
      finished: Math.max(finished, doneCount),
      untouched,
      statuses,
      can_next_round: campaign.status === 'ACTIVE' && campaign.round < rounds,
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

  /** Moves every unfinished lead to the next person in the rotation. */
  async nextRound(id: string, ctx: CampaignContext) {
    const campaign = await this.load(id, ctx.branch);
    const count = campaign.staff.length;
    if (campaign.status !== 'ACTIVE') {
      throw new ConflictException('This campaign is closed');
    }
    if (campaign.round >= count) {
      throw new ConflictException(
        'Every staff member has already had every lead; there is no next round',
      );
    }
    const stillHere = await this.users.countDocuments({
      _id: { $in: campaign.staff },
      branch: oid(ctx.branch),
    });
    if (stillHere !== count) {
      throw new ConflictException(
        'One of the staff in this campaign is no longer in the company',
      );
    }

    // only one click can win the move from round r to r+1
    const claimed = await this.campaigns
      .findOneAndUpdate(
        { _id: campaign._id, status: 'ACTIVE', round: campaign.round },
        { $set: { round: campaign.round + 1, updated_at: new Date() } },
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
      return await this.moveLeads(campaign, campaign.round + 1, ctx);
    } catch (e) {
      // put the round back so the same click can be tried again (already
      // moved leads are skipped the second time)
      await this.campaigns.updateOne(
        { _id: campaign._id, round: campaign.round + 1 },
        { $set: { round: campaign.round } },
      );
      throw e;
    }
  }

  private async moveLeads(campaign: any, nextRound: number, ctx: CampaignContext) {
    const count = campaign.staff.length;
    const latest = await this.latestRows(campaign._id);
    const latestBy = new Map(latest.map((l: any) => [String(l._id), l]));

    const open = await this.campaignLeads
      .find({ campaign: campaign._id, done: false })
      .lean()
      .exec();

    const finishedIds: any[] = [];
    const items: Record<string, any>[] = [];
    let takenBack = 0;
    let alreadyMoved = 0;

    for (const group of chunk(open, 100)) {
      await Promise.all(
        group.map(async (lead: any) => {
          const row: any = latestBy.get(String(lead.contact));
          if (row && (row.round ?? 0) >= nextRound) {
            alreadyMoved++; // a retry after a failed attempt
            return;
          }
          if (row && FINAL_STATUSES.includes(row.status)) {
            finishedIds.push(lead._id);
            return;
          }
          if (row && row.status === 'FRESH') {
            // never called by its holder: take it back so two people never hold it
            const gone = await this.userLeads
              .findOneAndDelete({ _id: row.row, status: 'FRESH' })
              .lean()
              .exec();
            if (gone) takenBack++;
          }
          items.push({
            contact: lead.contact,
            mobile: lead.mobile,
            name: lead.name,
            city: lead.city,
            user: campaign.staff[holderIndex(lead.batch, nextRound, count)],
            campaign: campaign._id,
            campaign_round: nextRound,
            assigned_by: ctx.actorName,
          });
        }),
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

    return {
      round: nextRound,
      moved: items.length + alreadyMoved,
      finished: finishedIds.length,
      untouched_taken_back: takenBack,
      message: `Round ${nextRound}: ${items.length + alreadyMoved} leads moved on, ${finishedIds.length} finished`,
    };
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
