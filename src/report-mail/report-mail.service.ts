import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { AttendanceService } from 'src/attendance/attendance.service';
import { SmartViewService } from 'src/dashboard/smart-view.service';
import { EmailService } from 'src/email/email.service';
import { attendanceDate, istHour, istHourSlot } from 'src/common/time.util';
import {
  ReportMailLog,
  ReportMailLogDocument,
  ReportMailSetting,
  ReportMailSettingDocument,
  ReportMailStatus,
} from './report-mail.schema';
import { renderSmartViewMail } from './report-mail.template';

export const MAX_RECIPIENTS = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// a send that has been "in progress" this long was interrupted (server stopped)
const STALE_SENDING_MS = 10 * 60 * 1000;

export interface ReportMailSettings {
  enabled: boolean;
  recipients: string[];
  from_hour: number;
  to_hour: number;
  only_logged_in: boolean;
  skip_if_unchanged: boolean;
}

export interface RunSummary {
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  locked: number;
}

const oid = (id: any) => new Types.ObjectId(String(id));

@Injectable()
export class ReportMailService implements OnModuleInit {
  private readonly logger = new Logger(ReportMailService.name);

  /** pause before the one retry of a failed send (tests make it 0) */
  retryDelayMs = 2000;

  constructor(
    @InjectModel(ReportMailSetting.name)
    private readonly settings: Model<ReportMailSettingDocument>,
    @InjectModel(ReportMailLog.name)
    private readonly logs: Model<ReportMailLogDocument>,
    @InjectModel('Branch') private readonly branches: Model<any>,
    @InjectModel('User') private readonly users: Model<any>,
    private readonly smartView: SmartViewService,
    private readonly attendance: AttendanceService,
    private readonly email: EmailService,
  ) {}

  // Make sure the indexes the hourly lock relies on exist, even where automatic
  // index creation is switched off.
  async onModuleInit() {
    try {
      await this.logs.createIndexes();
      await this.settings.createIndexes();
    } catch (err) {
      this.logger.warn(`could not create the report mail indexes: ${err}`);
    }
  }

  // ------------------------------------------------------------- settings

  /**
   * A company's settings. A company that never saved any gets the defaults,
   * with its admin's own address ready as the first recipient.
   */
  async getSettings(branchId: string) {
    const saved = await this.settings.findOne({ branch: oid(branchId) }).lean<any>();
    if (saved) {
      return this.present(saved, true);
    }
    const admin = await this.users
      .findOne({ branch: oid(branchId), role: 'admin', email: { $exists: true, $ne: '' } })
      .select('email')
      .lean<any>();
    return this.present(
      {
        enabled: false,
        recipients: admin?.email ? [String(admin.email).trim().toLowerCase()] : [],
        from_hour: 9,
        to_hour: 23,
        only_logged_in: false,
        skip_if_unchanged: false,
      },
      false,
    );
  }

  async saveSettings(branchId: string, input: Record<string, any>, userId?: string) {
    const current = await this.getSettings(branchId);
    const clean = this.validate({ ...current, ...pick(input) });

    await this.settings.findOneAndUpdate(
      { branch: oid(branchId) },
      {
        $set: { ...clean, updated_by: userId ? oid(userId) : undefined, updated_at: new Date() },
        $setOnInsert: { branch: oid(branchId), created_at: new Date() },
      },
      { upsert: true, new: true },
    );
    return this.getSettings(branchId);
  }

  async recentLogs(branchId: string, limit = 20) {
    return this.logs
      .find({ branch: oid(branchId) })
      .sort({ created_at: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  // ------------------------------------------------------------ scheduled

  /** Called at the top of every hour. Sends to every company that is due. */
  async runHourly(now: Date = new Date()): Promise<RunSummary> {
    const hour = istHour(now);
    const summary: RunSummary = { considered: 0, sent: 0, skipped: 0, failed: 0, locked: 0 };

    const due = await this.settings
      .find({ enabled: true, from_hour: { $lte: hour }, to_hour: { $gte: hour } })
      .lean<any[]>();

    for (const setting of due) {
      const branch = await this.branches.findById(setting.branch).lean<any>();
      if (!branch || branch.status !== 'Active' || new Date(branch.expiry_date) < now) {
        continue; // inactive or expired companies get nothing
      }
      if (!setting.recipients?.length) {
        continue;
      }
      summary.considered++;
      try {
        const outcome = await this.sendFor(setting, branch, now);
        if (outcome === 'SENT') summary.sent++;
        else if (outcome === 'SKIPPED') summary.skipped++;
        else if (outcome === 'FAILED') summary.failed++;
        else summary.locked++;
      } catch (err) {
        // one company must never stop the others
        summary.failed++;
        this.logger.error(`report mail for ${branch.name}: ${err}`);
      }
    }
    return summary;
  }

  /** One company, one hour. Returns what happened. */
  async sendFor(
    setting: any,
    branch: any,
    now: Date,
  ): Promise<ReportMailStatus | 'LOCKED'> {
    const slot = istHourSlot(now);
    if (!(await this.claim(branch._id, slot, setting.recipients.length, now))) {
      return 'LOCKED'; // already sent, or being sent, for this hour
    }

    try {
      const content = await this.build(branch, setting, now);

      if (setting.skip_if_unchanged && setting.last_digest === content.digest) {
        await this.finish(branch._id, slot, 'SKIPPED', undefined, now, setting.last_digest);
        return 'SKIPPED';
      }

      await this.deliver(setting.recipients, content.mail);
      await this.finish(branch._id, slot, 'SENT', undefined, now, content.digest);
      return 'SENT';
    } catch (err: any) {
      await this.finish(branch._id, slot, 'FAILED', this.message(err), now);
      return 'FAILED';
    }
  }

  // ----------------------------------------------------------------- test

  /** "Send test email now": same mail, to the saved recipients, outside the hourly lock. */
  async sendTest(branchId: string, now: Date = new Date()) {
    if (!this.email.isConfigured()) {
      throw new BadRequestException(
        'Mail is not set up on this server (MAIL_SERVER and SENDER_EMAIL are missing)',
      );
    }
    const setting: any = await this.getSettings(branchId);
    if (!setting.saved || !setting.recipients.length) {
      throw new BadRequestException('Save at least one email address first');
    }
    const branch = await this.branches.findById(branchId).lean<any>();
    if (!branch) {
      throw new BadRequestException('Company not found');
    }

    try {
      const content = await this.build(branch, setting, now);
      const mail = { ...content.mail, subject: '[TEST] ' + content.mail.subject };
      await this.deliver(setting.recipients, mail);
      await this.settings.updateOne(
        { branch: oid(branchId) },
        { $set: { last_sent_at: now, last_status: 'SENT', last_error: null } },
      );
      return { sent_to: setting.recipients, subject: mail.subject };
    } catch (err: any) {
      const message = this.message(err);
      await this.settings.updateOne(
        { branch: oid(branchId) },
        { $set: { last_sent_at: now, last_status: 'FAILED', last_error: message } },
      );
      throw new BadGatewayException(`The email could not be sent: ${message}`);
    }
  }

  // -------------------------------------------------------------- helpers

  private async build(branch: any, setting: any, now: Date) {
    const people = await this.users
      .find({ branch: branch._id })
      .select('role')
      .lean<any[]>();
    const everyone = people.map((p) => String(p._id));
    const staff = people
      .filter((p) => p.role === 'teamlead' || p.role === 'employee')
      .map((p) => String(p._id));

    const day = attendanceDate(now);
    const [view, attended] = await Promise.all([
      this.smartView.build({
        userIds: everyone,
        from: day,
        to: day,
        loggedInOnly: !!setting.only_logged_in,
        page: 0,
        size: 500,
      }),
      this.attendance.rangeSummary(day, day, { users: staff }),
    ]);

    const mail = renderSmartViewMail({
      companyName: branch.name,
      sentAt: now,
      range: view.range,
      rows: view.result as any,
      loggedIn: { count: attended.length, total: staff.length },
      onlyLoggedIn: !!setting.only_logged_in,
    });
    return { mail, digest: digestOf(view.result) };
  }

  // One try, one retry after a pause, then give up with the last error.
  private async deliver(recipients: string[], mail: { subject: string; html: string; text: string }) {
    try {
      await this.email.sendHtml({ to: recipients, ...mail });
    } catch {
      await new Promise((r) => setTimeout(r, this.retryDelayMs));
      await this.email.sendHtml({ to: recipients, ...mail });
    }
  }

  // Take the (company, hour) row. Fails when another run already holds it, but
  // a failed or abandoned send can be picked up again. The row is created with
  // one atomic upsert, so a second run can never create a second one; the unique
  // index additionally covers two runs at the very same instant.
  private async claim(branchId: any, slot: string, count: number, now: Date): Promise<boolean> {
    let existing: any;
    try {
      existing = await this.logs
        .findOneAndUpdate(
          { branch: branchId, slot },
          { $setOnInsert: { branch: branchId, slot, status: 'SENDING', recipients_count: count, created_at: now } },
          { upsert: true, new: false },
        )
        .lean();
    } catch (err: any) {
      if (err?.code !== 11000) {
        throw err;
      }
      // lost a race with another run: look at what it created
      existing = await this.logs.findOne({ branch: branchId, slot }).lean();
    }
    if (!existing) {
      return true; // we created the row, so the hour is ours
    }

    const abandoned =
      existing.status === 'SENDING' &&
      now.getTime() - new Date(existing.created_at).getTime() > STALE_SENDING_MS;
    if (existing.status !== 'FAILED' && !abandoned) {
      return false;
    }
    const taken = await this.logs.findOneAndUpdate(
      { _id: existing._id, status: existing.status },
      { $set: { status: 'SENDING', recipients_count: count, created_at: now }, $unset: { error: '', finished_at: '' } },
    );
    return !!taken;
  }

  private async finish(
    branchId: any,
    slot: string,
    status: ReportMailStatus,
    error: string | undefined,
    now: Date,
    digest?: string,
  ) {
    await this.logs.updateOne(
      { branch: branchId, slot },
      { $set: { status, finished_at: new Date(), ...(error ? { error } : {}) } },
    );
    await this.settings.updateOne(
      { branch: branchId },
      {
        $set: {
          last_sent_at: now,
          last_status: status,
          last_error: error ?? null,
          ...(digest ? { last_digest: digest } : {}),
        },
      },
    );
  }

  private message(err: any): string {
    return String(err?.message ?? err).slice(0, 300);
  }

  private present(doc: any, saved: boolean) {
    return {
      saved,
      enabled: !!doc.enabled,
      recipients: doc.recipients ?? [],
      from_hour: doc.from_hour ?? 9,
      to_hour: doc.to_hour ?? 23,
      only_logged_in: !!doc.only_logged_in,
      skip_if_unchanged: !!doc.skip_if_unchanged,
      last_sent_at: doc.last_sent_at ?? null,
      last_status: doc.last_status ?? null,
      last_error: doc.last_error ?? null,
    };
  }

  // What may be saved. Everything is checked here, whatever the screen did.
  private validate(input: Record<string, any>): ReportMailSettings {
    if (!Array.isArray(input.recipients)) {
      throw new BadRequestException('recipients must be a list of email addresses');
    }
    const recipients: string[] = [];
    for (const raw of input.recipients) {
      const address = String(raw ?? '').trim().toLowerCase();
      if (!address) continue;
      if (address.length > 254 || !EMAIL.test(address)) {
        throw new BadRequestException(`"${String(raw).slice(0, 60)}" is not a valid email address`);
      }
      if (!recipients.includes(address)) recipients.push(address);
    }
    if (recipients.length > MAX_RECIPIENTS) {
      throw new BadRequestException(`At most ${MAX_RECIPIENTS} email addresses`);
    }

    const hour = (value: any, name: string) => {
      if (!Number.isInteger(value) || value < 0 || value > 23) {
        throw new BadRequestException(`${name} must be a whole hour from 0 to 23`);
      }
      return value as number;
    };
    const from_hour = hour(input.from_hour, 'from_hour');
    const to_hour = hour(input.to_hour, 'to_hour');
    if (from_hour > to_hour) {
      throw new BadRequestException('The first hour must not be after the last hour');
    }

    const flag = (value: any, name: string) => {
      if (typeof value !== 'boolean') {
        throw new BadRequestException(`${name} must be true or false`);
      }
      return value;
    };
    const enabled = flag(input.enabled, 'enabled');
    if (enabled && recipients.length === 0) {
      throw new BadRequestException('Add at least one email address before switching it on');
    }

    return {
      enabled,
      recipients,
      from_hour,
      to_hour,
      only_logged_in: flag(input.only_logged_in, 'only_logged_in'),
      skip_if_unchanged: flag(input.skip_if_unchanged, 'skip_if_unchanged'),
    };
  }
}

// Only the fields a screen may set.
function pick(input: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const key of ['enabled', 'recipients', 'from_hour', 'to_hour', 'only_logged_in', 'skip_if_unchanged']) {
    if (input && input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

/** A fingerprint of the numbers in a smart view, to tell whether anything changed. */
export function digestOf(rows: { user: string; status: Record<string, number> }[]): string {
  const stable = [...rows]
    .sort((a, b) => String(a.user).localeCompare(String(b.user)))
    .map((r) => [String(r.user), ...Object.keys(r.status).sort().map((k) => r.status[k])]);
  return createHash('sha1').update(JSON.stringify(stable)).digest('hex');
}
