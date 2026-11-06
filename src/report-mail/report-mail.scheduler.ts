import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmailService } from 'src/email/email.service';
import { ReportMailService } from './report-mail.service';

/** Runs the hourly smart-view mail at the top of every hour, India time. */
@Injectable()
export class ReportMailScheduler {
  private readonly logger = new Logger(ReportMailScheduler.name);

  constructor(
    private readonly service: ReportMailService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 * * * *', { name: 'report-mail-hourly', timeZone: 'Asia/Kolkata' })
  async hourly() {
    // a copy of the app without mail settings (a developer's computer) must never
    // take an hour's slot away from the real server
    if (process.env.REPORT_MAIL_DISABLED === 'true') {
      return;
    }
    if (!this.email.isConfigured()) {
      this.logger.debug('Mail is not configured here: no report mails');
      return;
    }
    try {
      const summary = await this.service.runHourly();
      if (summary.considered > 0) {
        this.logger.log(`Report mails: ${JSON.stringify(summary)}`);
      }
    } catch (err) {
      this.logger.error(`Report mails failed: ${err}`);
    }
  }
}
