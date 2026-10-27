import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  LeadActivity,
  LeadActivityDocument,
  LeadActivitySource,
} from './lead-activity.schema';

const oid = (id: any) => new Types.ObjectId(String(id));

@Injectable()
export class LeadActivityService {
  private readonly logger = new Logger(LeadActivityService.name);

  constructor(
    @InjectModel(LeadActivity.name)
    private readonly model: Model<LeadActivityDocument>,
  ) {}

  /** The leads were just handed to staff. `docs` are the saved calling rows. */
  async logAssigned(
    source: LeadActivitySource,
    docs: any[],
    actorId?: string,
  ) {
    const entries = docs
      .filter((d) => d?.contact && d?.user && d?.branch)
      .map((d) => ({
        contact: oid(d.contact),
        branch: oid(d.branch),
        user: oid(d.user),
        actor: actorId ? oid(actorId) : oid(d.user),
        type: 'ASSIGNED',
        source,
        lead: d._id,
        to_status: d.status ?? 'FRESH',
        created_at: new Date(),
      }));
    if (entries.length === 0) {
      return;
    }
    try {
      await this.model.insertMany(entries as any);
    } catch (err) {
      // the activity trail must never stop the user's real action
      this.logger.error(`could not write assignment activity: ${err}`);
    }
  }

  /** Staff worked a lead and (re)set its status. */
  async logStatusUpdate(
    source: LeadActivitySource,
    before: {
      _id: any;
      contact?: any;
      user: any;
      branch: any;
      status?: string;
    },
    toStatus: string,
    actorId?: string,
  ) {
    if (!before?.contact || !before?.user || !before?.branch) {
      return; // rows created before contacts existed have nothing to attach to
    }
    try {
      await this.model.create({
        contact: oid(before.contact),
        branch: oid(before.branch),
        user: oid(before.user),
        actor: actorId ? oid(actorId) : oid(before.user),
        type: 'STATUS_UPDATE',
        source,
        lead: before._id,
        from_status: before.status,
        to_status: toStatus,
        created_at: new Date(),
      } as any);
    } catch (err) {
      this.logger.error(`could not write status activity: ${err}`);
    }
  }

  async history(contactId: string, page = 0, size = 20) {
    const filter = { contact: oid(contactId) };
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ created_at: -1 })
        .skip(page * size)
        .limit(size)
        .populate('user', 'username first_name last_name')
        .populate('actor', 'username first_name last_name')
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  /** Counts for one contact: times handed out, times worked, who and when. */
  async summary(contactId: string) {
    const filter = { contact: oid(contactId) };
    const [counts, last] = await Promise.all([
      this.model.aggregate([
        { $match: filter },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      this.model
        .findOne({ ...filter, type: 'STATUS_UPDATE' })
        .sort({ created_at: -1 })
        .populate('user', 'username first_name last_name')
        .lean()
        .exec(),
    ]);

    const count = (type: string) =>
      counts.find((c) => c._id === type)?.count ?? 0;

    return {
      times_assigned: count('ASSIGNED'),
      times_worked: count('STATUS_UPDATE'),
      last_status: last?.to_status ?? null,
      last_worked_by: (last?.user as any) ?? null,
      last_worked_at: last?.created_at ?? null,
    };
  }
}
