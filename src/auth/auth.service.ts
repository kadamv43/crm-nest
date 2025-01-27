import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthPayloadDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { PatientsService } from 'src/patients/patients.service';
import * as bcrypt from 'bcrypt';
import { Branch } from 'src/branches/branch.schema';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private patientService: PatientsService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.usersService.findByField({ username });
    if (user && (await bcrypt.compare(password, user.password))) {
      return user;
    }
    throw new UnauthorizedException('Invalid credentials');
  }

  async validatePatient(mobile: string, otp: string) {
    const patient = await this.patientService.findByOne({ mobile });
    if (patient && otp === '1234') {
      return patient;
    }
    throw new UnauthorizedException('Invalid OTP');
  }

  async loginUser(user: any) {
    const payload = {
      sub: user._id,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      email: user.email,
      role: user.role,
      mobile: user.mobile,
      branch: user.branch,
    };
    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  async loginPatient(patient: any) {
    let plainPatient = patient.toObject();
    let data = { ...plainPatient, sub: plainPatient._id };
    console.log(data);
    return {
      accessToken: this.jwtService.sign(data),
    };
  }
}
