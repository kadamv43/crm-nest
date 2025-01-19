import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      name: 'mail.advisory.in',
      host: 'mail.advisory.in', // or another email service provider
      port: 587,
      secure: false,
      debug: true,
      auth: {
        user: 'info@advisory.in', // Your email address
        pass: '~~[kvte%(mNI', // Your email password
      },
    });
  }

  async sendMail(to: string, subject: string, text: string): Promise<void> {
    const mailOptions: nodemailer.SendMailOptions = {
      from: 'info@advisory.in',
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
}
