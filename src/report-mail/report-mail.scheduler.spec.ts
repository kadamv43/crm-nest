import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { ReportMailScheduler } from './report-mail.scheduler';

describe('ReportMailScheduler', () => {
  const saved = { ...process.env };
  let service: { runHourly: jest.Mock };
  let email: { isConfigured: jest.Mock };
  let scheduler: ReportMailScheduler;

  beforeEach(() => {
    delete process.env.REPORT_MAIL_DISABLED;
    service = { runHourly: jest.fn().mockResolvedValue({ considered: 0, sent: 0, skipped: 0, failed: 0, locked: 0 }) };
    email = { isConfigured: jest.fn().mockReturnValue(true) };
    scheduler = new ReportMailScheduler(service as any, email as any);
  });

  afterAll(() => {
    process.env = saved;
  });

  describe('when it runs', () => {
    const options = () => Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, ReportMailScheduler.prototype.hourly);

    it('at minute 0 of every hour', () => {
      expect(options().cronTime).toBe('0 * * * *');
    });

    it('in India time, not the server\'s time zone', () => {
      expect(options().timeZone).toBe('Asia/Kolkata');
    });
  });

  describe('what it does each hour', () => {
    it('asks the service to send what is due', async () => {
      await scheduler.hourly();
      expect(service.runHourly).toHaveBeenCalledTimes(1);
    });

    it('does nothing when switched off with REPORT_MAIL_DISABLED', async () => {
      process.env.REPORT_MAIL_DISABLED = 'true';
      await scheduler.hourly();
      expect(service.runHourly).not.toHaveBeenCalled();
    });

    it('only the exact value "true" switches it off', async () => {
      process.env.REPORT_MAIL_DISABLED = 'false';
      await scheduler.hourly();
      expect(service.runHourly).toHaveBeenCalledTimes(1);
    });

    it('does nothing where no mail server is set up, so it never takes an hour away from the real server', async () => {
      email.isConfigured.mockReturnValue(false);
      await scheduler.hourly();
      expect(service.runHourly).not.toHaveBeenCalled();
    });

    it('a failure is logged and never escapes (it would stop the scheduler)', async () => {
      service.runHourly.mockRejectedValue(new Error('database down'));
      await expect(scheduler.hourly()).resolves.toBeUndefined();
    });
  });
});
