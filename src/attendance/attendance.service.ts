import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance, AttendanceDocument } from './attendance.schema';
import { attendanceDate } from 'src/common/time.util';

const oid = (id: any) => new Types.ObjectId(String(id));

@Injectable()
export class AttendanceService {
  constructor(
    @InjectModel(Attendance.name)
    private readonly model: Model<AttendanceDocument>,
  ) {}

  /**
   * A successful login. The first login of the attendance day creates the
   * row and fixes the first-login time; later logins that day only raise the
   * count. Safe when two logins arrive at the same moment.
   */
  async recordLogin(
    userId: string,
    branchId: string,
    now: Date = new Date(),
  ): Promise<AttendanceDocument> {
    const filter = { user: oid(userId), date: attendanceDate(now) };
    const update = {
      $setOnInsert: { branch: oid(branchId) },
      $min: { first_login_at: now }, // earliest wins even if requests race
      $max: { last_login_at: now },
      $inc: { login_count: 1 },
    };
    const options = { upsert: true, new: true };

    try {
      return await this.model.findOneAndUpdate(filter, update, options);
    } catch (err: any) {
      // two first logins at once: one insert wins, the other retries as an update
      if (err?.code !== 11000) {
        throw err;
      }
      return this.model.findOneAndUpdate(filter, update, options);
    }
  }

  /** Who logged in on an attendance day, earliest first. */
  async list(date: string, branch?: string) {
    const filter: Record<string, any> = { date };
    if (branch) {
      filter.branch = oid(branch);
    }
    const data = await this.model
      .find(filter)
      .sort({ first_login_at: 1 })
      .populate('user', 'username first_name last_name role mobile')
      .populate('branch', 'name')
      .lean()
      .exec();
    return { date, data, total: data.length };
  }

  /**
   * Who logged in during a range of attendance days (one day when `to` is
   * left out): the earliest first-login and how many of the days they were
   * present. Limited to some people and/or one company when asked.
   */
  async rangeSummary(
    from: string,
    to: string = from,
    options: { branch?: string; users?: string[] } = {},
  ): Promise<{ user: string; first_login_at: Date; days_present: number }[]> {
    const match: Record<string, any> = { date: { $gte: from, $lte: to } };
    if (options.branch) {
      match.branch = oid(options.branch);
    }
    if (options.users) {
      match.user = { $in: options.users.map(oid) };
    }
    const rows = await this.model.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$user',
          first_login_at: { $min: '$first_login_at' },
          days_present: { $sum: 1 },
        },
      },
    ]);
    return rows.map((r) => ({
      user: String(r._id),
      first_login_at: r.first_login_at,
      days_present: r.days_present,
    }));
  }

  /** Ids of the people who logged in on an attendance day. */
  async loggedInUserIds(date: string, branch?: string): Promise<string[]> {
    const filter: Record<string, any> = { date };
    if (branch) {
      filter.branch = oid(branch);
    }
    const rows = await this.model.find(filter).select('user').lean().exec();
    return rows.map((r: any) => String(r.user));
  }
}
