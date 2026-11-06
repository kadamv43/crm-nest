import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

// The password that used to be written into this file. It is only used while
// MAIL_PASSWORD is not set on the server, and will be removed once it is.
const LEGACY_MAIL_PASSWORD = '~~[kvte%(mNI';

export interface HtmlMail {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    if (!process.env.MAIL_PASSWORD) {
      this.logger.warn(
        'MAIL_PASSWORD is not set: using the built-in mail password. Set MAIL_PASSWORD on the server.',
      );
    }
    this.transporter = nodemailer.createTransport({
      name: process.env.MAIL_SERVER,
      host: process.env.MAIL_SERVER, // or another email service provider
      // 465 with TLS unless the server says otherwise (MAIL_PORT / MAIL_SECURE)
      port: Number(process.env.MAIL_PORT) || 465,
      secure: process.env.MAIL_SECURE !== 'false',
      debug: true,
      auth: {
        user: process.env.SENDER_EMAIL, // Your email address
        pass: process.env.MAIL_PASSWORD || LEGACY_MAIL_PASSWORD,
      },
    });
  }

  /** True when a mail server and sender are configured (scheduled mails only run then). */
  isConfigured(): boolean {
    return !!(process.env.MAIL_SERVER && process.env.SENDER_EMAIL);
  }

  /** Plain-text mail that never fails the caller (password reset codes). */
  async sendMail(to: string, subject: string, text: string): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: process.env.SENDER_EMAIL,
      to,
      subject,
      text,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully');
    } catch (error) {
      console.error('Error sending email:', error);
    }
  }

  /**
   * An HTML mail (with a plain-text copy) to one or several people in a single
   * message. Unlike sendMail this THROWS when sending fails, so the caller can
   * record the failure and retry.
   */
  async sendHtml(mail: HtmlMail): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to: Array.isArray(mail.to) ? mail.to.join(', ') : mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }
}
