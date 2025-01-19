import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      name: process.env.MAIL_SERVER,
      host: process.env.MAIL_SERVER, // or another email service provider
      port: 465,
      secure: true,
      debug: true,
      auth: {
        user: process.env.SENDER_EMAIL, // Your email address
        pass: '~~[kvte%(mNI', // Your email password
      },
    });
  }

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
}
