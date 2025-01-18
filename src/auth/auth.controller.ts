import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { PatientsService } from 'src/patients/patients.service';
import { OtpService } from 'src/otp/otp.service';
import { SignUpDto } from 'src/patients/dto/signup.dto';
import { UsersService } from 'src/users/users.service';
import { User } from 'src/users/user.schema';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private patientService: PatientsService,
    private otpService: OtpService,
    private userService: UsersService,
  ) {}

  @Post('login')
  async loginUser(@Body() loginDto: { email: string; password: string }) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    return this.authService.loginUser(user);
  }

  @Post('login/patient')
  async login(@Body() body) {
    const patient: any = await this.patientService.findBy({
      mobile: body.mobile,
    });

    if (patient.length == 0) {
      throw new NotFoundException('Mobile number does not exist');
    }

    await this.otpService.sendOtp({ mobile: patient[0]?.mobile });

    return {
      message: 'OTP sent successfully on your whatsapp',
      data: [],
    };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body) {
    const { mobile, otp } = body;
    const patient: any = await this.patientService.findBy({
      mobile,
    });
    if (patient.length == 0) {
      throw new NotFoundException('Mobile number does not exist');
    }

    const otpVerified = await this.otpService.verifyOTP({ mobile, otp });

    if (otpVerified) {
      const token = await this.authService.loginPatient(patient[0]);
      return { message: 'OTP verifed successfully', data: token };
    } else {
      throw new NotFoundException('Invalid OTP');
    }
  }

  @Get('details')
  @UseGuards(AuthGuard('jwt'))
  status(@Request() req) {
    console.log(req.user);
    return JSON.stringify(req.user);
  }

  @Post('signup')
  async signup(@Body() createPatientDto: SignUpDto) {
    let patient_number =
      await this.patientService.generateUniquePatientNumber();
    createPatientDto.patient_number = patient_number;
    const patient: any = await this.patientService.create(createPatientDto);
    return {
      message: 'Registration Successfull please login',
      data: [],
    };
  }

  @Get('email/search')
  async findBy(@Query() query: Record<string, any>): Promise<User[]> {
    return this.userService.findBy(query);
  }

  @Get('forgot-password/:id')
  async forgotPassword(@Param('id') id: string) {
    return this.userService.forgotPasswordEmail(id);
  }

  @Post('reset-password/:id')
  resetPassword(@Param('id') id: string, @Body() body: any) {
    return this.userService.resetPassword(id, body);
  }
}
