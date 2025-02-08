import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Render,
  Req,
} from '@nestjs/common';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { CreateAppointmentWebDto } from 'src/appointments/dto/create-appointment-web.dto';
import { PatientsService } from 'src/patients/patients.service';
import * as https from 'https';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AuthService } from 'src/auth/auth.service';
import { OtpService } from 'src/otp/otp.service';
import { InvoiceService } from 'src/invoice/invoice.service';

@Controller('web')
export class WebController {
  constructor(
    private patientService: PatientsService,
    private appointmentService: AppointmentsService,
    private otpService: OtpService,
    private invoiceService: InvoiceService,
  ) {}

  @Post('appointment')
  async createAppointment(@Body() body) {
    const patient = await this.patientService.create(body);

    let appointment_number =
      await this.appointmentService.generateUniqueAppointmentNumber();

    let createAppointmentDto: CreateAppointmentWebDto = {
      appointment_number: appointment_number,
      patient,
      reason: body.message,
      remark: '',
      status: 'created',
      appointment_time: body.appointment_date,
      appointment_date: body.appointment_date,
    };

    return this.appointmentService.createFromWeb(createAppointmentDto);
  }

  @Post('get-appointment-by-mobile')
  async findAll(@Body() body) {
    const { mobile } = body;
    const patient: any = await this.patientService.findBy({
      mobile,
    });
    if (patient.length == 0) {
      return { message: 'No Patient exist for this Mobile Number', data: [] };
    }
    const appointments = await this.appointmentService.findByPatienId(
      patient[0]?._id,
    );
    // if (appointments.length == 0) {
    //   return {
    //     message: 'No Appointments exist for this Mobile Number',
    //     data: [],
    //   };
    // }

    await this.otpService.sendOtp({ mobile });

    return {
      message: 'OTP sent successfully on your whatsapp',
      data: [],
    };
  }

  @Post('verify-otp-for-reports')
  async verifyOtpForReports(@Body() body) {
    const { mobile, otp } = body;
    const patient: any = await this.patientService.findBy({
      mobile,
    });
    if (patient.length == 0) {
      return { message: 'No Patient exist for this Mobile Number', data: [] };
    }

    const otpVerified = await this.otpService.verifyOTP({ mobile, otp });

    if (otpVerified) {
      const appointments = await this.appointmentService.findByPatienId(
        patient[0]?._id,
      );
      // if (appointments.length == 0) {
      //   return {
      //     message: 'No Appointments exist for this Mobile Number',
      //     data: [],
      //   };
      // }

      return { message: 'OTP verifed successfully', data: appointments };
    } else {
      return { message: 'OTP invalid', data: [] };
    }
  }

  @Get('invoice/:id')
  @Render('invoice') // Render the 'page' template
  async getPageById(@Param('id') id: string): Promise<any> {
    const invoice = await this.invoiceService.findOne(id);
    return invoice;
  }
}
