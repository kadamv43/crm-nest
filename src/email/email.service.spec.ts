import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer');

describe('EmailService', () => {
  const sendMail = jest.fn();
  const createTransport = nodemailer.createTransport as unknown as jest.Mock;
  const saved = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({});
    for (const key of ['MAIL_SERVER', 'SENDER_EMAIL', 'MAIL_PASSWORD', 'MAIL_PORT', 'MAIL_SECURE']) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = saved;
  });

  const options = () => createTransport.mock.calls[0][0];

  describe('how it connects', () => {
    it('takes the password from MAIL_PASSWORD when it is set', () => {
      process.env.MAIL_PASSWORD = 'from-the-server';
      new EmailService();
      expect(options().auth.pass).toBe('from-the-server');
    });

    it('keeps working with the old built-in password until MAIL_PASSWORD is set', () => {
      new EmailService();
      expect(options().auth.pass).toBeTruthy();
      expect(options().auth.pass).not.toBe('undefined');
    });

    it('uses port 465 with TLS unless told otherwise', () => {
      new EmailService();
      expect(options().port).toBe(465);
      expect(options().secure).toBe(true);
    });

    it('MAIL_PORT and MAIL_SECURE change that', () => {
      process.env.MAIL_PORT = '2525';
      process.env.MAIL_SECURE = 'false';
      new EmailService();
      expect(options().port).toBe(2525);
      expect(options().secure).toBe(false);
    });

    it('uses the configured server and sender', () => {
      process.env.MAIL_SERVER = 'mail.example.com';
      process.env.SENDER_EMAIL = 'crm@example.com';
      new EmailService();
      expect(options().host).toBe('mail.example.com');
      expect(options().auth.user).toBe('crm@example.com');
    });
  });

  describe('isConfigured', () => {
    it('needs both a server and a sender', () => {
      const service = new EmailService();
      expect(service.isConfigured()).toBe(false);
      process.env.MAIL_SERVER = 'mail.example.com';
      expect(service.isConfigured()).toBe(false);
      process.env.SENDER_EMAIL = 'crm@example.com';
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('sendHtml', () => {
    beforeEach(() => {
      process.env.SENDER_EMAIL = 'crm@example.com';
    });

    it('sends one message to everyone, with the html and a text copy', async () => {
      await new EmailService().sendHtml({
        to: ['a@x.com', 'b@x.com', 'c@x.com'],
        subject: 'Hello',
        html: '<b>hi</b>',
        text: 'hi',
      });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith({
        from: 'crm@example.com',
        to: 'a@x.com, b@x.com, c@x.com',
        subject: 'Hello',
        text: 'hi',
        html: '<b>hi</b>',
      });
    });

    it('accepts a single address', async () => {
      await new EmailService().sendHtml({ to: 'a@x.com', subject: 's', html: 'h', text: 't' });
      expect(sendMail.mock.calls[0][0].to).toBe('a@x.com');
    });

    it('fails loudly, so the caller can retry and record it', async () => {
      sendMail.mockRejectedValue(new Error('connection refused'));
      await expect(
        new EmailService().sendHtml({ to: 'a@x.com', subject: 's', html: 'h', text: 't' }),
      ).rejects.toThrow('connection refused');
    });
  });

  describe('sendMail (password reset codes)', () => {
    it('still sends plain text', async () => {
      process.env.SENDER_EMAIL = 'crm@example.com';
      await new EmailService().sendMail('a@x.com', 'Code', 'Your code is 1');
      expect(sendMail).toHaveBeenCalledWith({ from: 'crm@example.com', to: 'a@x.com', subject: 'Code', text: 'Your code is 1' });
    });

    it('still never throws', async () => {
      sendMail.mockRejectedValue(new Error('down'));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(new EmailService().sendMail('a@x.com', 's', 't')).resolves.toBeUndefined();
    });
  });
});
