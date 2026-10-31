import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeadActivity, LeadActivityDocument } from 'src/contacts/lead-activity.schema';
import { escapeRegex } from 'src/contacts/pool.helper';
import { AttendanceService } from 'src/attendance/attendance.service';
import { User } from 'src/users/user.schema';
import { attendanceDate, attendanceDayRange } from 'src/common/time.util';

const oid = (id: any) => new Types.ObjectId(String(id));

export interface SmartViewQuery {
  /** the staff the caller may see (already limited to their company / team) */
  userIds: string[];
  /** attendance days "YYYY-MM-DD"; both default to the current attendance day */
  from?: string;
  to?: string;
  /** username contains this text */
  q?: string;
  /** only people who logged in during the range, zeros shown for the quiet ones */
  loggedInOnly?: boolean;
  page?: number;
  size?: number;
}

// The status columns of the table, in the names the screen uses.
const STATUS_COLUMNS: Record<string, string> = {
  CALLBACK: 'callback',
  FREE_TRIAL: 'free_trial',
  RINGING: 'ringing',
  SWITCHED_OFF: 'switched_off',
  DEAD: 'dead',
  NOT_REACHABLE: 'not_reachable',
  NOT_INTERESTED: 'not_interested',
  EXPECTED_PAYMENT: 'expected_payment',
  PAYMENT_DONE: 'payment_done',
};

/**
 * The smart view: per staff member, what happened to their leads in a period.
 * Every number is worked out from the activity log, so any past day gives the
 * same answer today or next month, and today needs no special case.
 *
 *   Assigned          leads handed to them in the period
 *   Carried forward   leads still untouched when the period began
 *   Fresh (left)      leads still untouched when the period ended
 *   Total Dialed      different leads they worked in the period
 *   each status       of those, how many ended the period in that status
 *   Total             Fresh (left) + Total Dialed
 */
@Injectable()
export class SmartViewService {
  constructor(
    @InjectModel(LeadActivity.name)
    private readonly activity: Model<LeadActivityDocument>,
    @InjectModel(User.name) private readonly users: Model<any>,
    private readonly attendance: AttendanceService,
  ) {}

  async build(query: SmartViewQuery) {
    const page = Math.max(0, query.page ?? 0);
    const size = Math.max(1, query.size ?? 50);
    const from = query.from ?? attendanceDate();
    const to = query.to ?? from;
    const { start, end } = attendanceDayRange(from, to);

    const scope = query.userIds.map(oid);

    const [worked, freshAtEnd, freshAtStart, attended] = await Promise.all([
      this.workedInRange(scope, start, end),
      this.untouchedAt(scope, end),
      this.untouchedAt(scope, new Date(start.getTime() - 1)),
      this.attendance.rangeSummary(from, to, { users: query.userIds }),
    ]);
    const attendedBy = new Map(attended.map((a) => [a.user, a]));

    // who gets a row
    let rowIds: string[];
    if (query.loggedInOnly) {
      rowIds = attended.map((a) => a.user);
    } else {
      const withData = new Set<string>();
      worked.forEach((w, id) => (w.assigned > 0 || w.dialed > 0) && withData.add(id));
      freshAtEnd.forEach((n, id) => n > 0 && withData.add(id));
      freshAtStart.forEach((n, id) => n > 0 && withData.add(id));
      rowIds = [...withData];
    }

    // names, and the username search
    const userFilter: Record<string, any> = { _id: { $in: rowIds.map(oid) } };
    if (query.q && query.q.trim() !== '') {
      userFilter.username = new RegExp(escapeRegex(query.q.trim()), 'i');
    }
    const people = rowIds.length
      ? await this.users.find(userFilter).select('username mobile').lean<any[]>()
      : [];

    const rows = people
      .map((person) => {
        const id = String(person._id);
        const w = worked.get(id);
        const fresh = freshAtEnd.get(id) ?? 0;
        const dialed = w?.dialed ?? 0;
        const status: Record<string, number> = {
          total: fresh + dialed,
          total_dialed: dialed,
          fresh,
          assigned: w?.assigned ?? 0,
          carried_forward: freshAtStart.get(id) ?? 0,
        };
        for (const column of Object.values(STATUS_COLUMNS)) {
          status[column] = w?.byStatus[column] ?? 0;
        }
        const seen = attendedBy.get(id);
        return {
          user: id,
          userDetails: { username: person.username, mobile: person.mobile },
          status,
          attendance: seen
            ? { first_login_at: seen.first_login_at, days_present: seen.days_present }
            : null,
        };
      })
      .sort((a, b) =>
        a.userDetails.username.localeCompare(b.userDetails.username, 'en', {
          sensitivity: 'base',
        }),
      );

    return {
      total: rows.length,
      result: rows.slice(page * size, page * size + size),
      range: { from, to },
    };
  }

  // Of the leads touched in the period: how many were handed out, and how many
  // were worked, split by the status each one ended the period in.
  private async workedInRange(users: Types.ObjectId[], start: Date, end: Date) {
    const rows = await this.activity.aggregate(
      [
        {
          $match: {
            user: { $in: users },
            source: 'LEAD',
            lead: { $ne: null },
            created_at: { $gte: start, $lte: end },
          },
        },
        { $sort: { created_at: 1, _id: 1 } },
        {
          $group: {
            _id: '$lead',
            user: { $last: '$user' },
            last: { $last: '$to_status' },
            // handed out as a fresh lead in the period
            assigned: {
              $max: {
                $cond: [
                  { $and: [{ $eq: ['$type', 'ASSIGNED'] }, { $eq: ['$to_status', 'FRESH'] }] },
                  1,
                  0,
                ],
              },
            },
            // a status was set, or a repeat-payment row was created already marked
            worked: {
              $max: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$type', 'STATUS_UPDATE'] },
                      { $and: [{ $eq: ['$type', 'ASSIGNED'] }, { $ne: ['$to_status', 'FRESH'] }] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $group: {
            _id: '$user',
            assigned: { $sum: '$assigned' },
            // a worked lead that ended the period back at FRESH is untouched again, not dialed
            statuses: {
              $push: {
                $cond: [
                  { $and: [{ $eq: ['$worked', 1] }, { $ne: ['$last', 'FRESH'] }] },
                  '$last',
                  null,
                ],
              },
            },
          },
        },
      ],
      { allowDiskUse: true },
    );

    const result = new Map<string, { assigned: number; dialed: number; byStatus: Record<string, number> }>();
    for (const row of rows) {
      const byStatus: Record<string, number> = {};
      let dialed = 0;
      for (const status of row.statuses as (string | null)[]) {
        if (status === null) {
          continue;
        }
        dialed++;
        const column = STATUS_COLUMNS[status];
        if (column) {
          byStatus[column] = (byStatus[column] ?? 0) + 1;
        }
      }
      result.set(String(row._id), { assigned: row.assigned, dialed, byStatus });
    }
    return result;
  }

  // Leads whose latest status at a moment was FRESH (still untouched), per
  // person. Leads that have since been deleted are not counted.
  private async untouchedAt(users: Types.ObjectId[], moment: Date) {
    const rows = await this.activity.aggregate(
      [
        {
          $match: {
            user: { $in: users },
            source: 'LEAD',
            lead: { $ne: null },
            created_at: { $lte: moment },
          },
        },
        { $sort: { created_at: 1, _id: 1 } },
        { $group: { _id: '$lead', user: { $last: '$user' }, last: { $last: '$to_status' } } },
        { $match: { last: 'FRESH' } },
        {
          $lookup: {
            from: 'userleads',
            localField: '_id',
            foreignField: '_id',
            pipeline: [{ $project: { _id: 1 } }],
            as: 'row',
          },
        },
        { $match: { row: { $ne: [] } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ],
      { allowDiskUse: true },
    );
    return new Map<string, number>(rows.map((r) => [String(r._id), r.count]));
  }
}
