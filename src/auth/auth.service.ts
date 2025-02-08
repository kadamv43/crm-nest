import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthPayloadDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { PatientsService } from 'src/patients/patients.service';
import * as bcrypt from 'bcrypt';
import { Branch } from 'src/branches/branch.schema';
import { Role } from './roles.enum';

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

    if (user.role !== 'superadmin') {
      const isExpired = await this.checkAccountExpiry(payload.branch);

      if (payload.branch.status == 'Inactive') {
        throw new ForbiddenException('Your account is Inactive');
      }
      if (isExpired === 'expired') {
        throw new ForbiddenException('Your account is expired');
      }
    }

    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  async checkAccountExpiry(branch: any): Promise<string> {
    if (!branch || !branch.expiry_date) {
      throw new Error('Branch or expiry date is missing');
    }

    const expiryDate = new Date(branch.expiry_date); // Ensure correct date parsing
    return expiryDate < new Date() ? 'expired' : 'success';
  }

  async loginPatient(patient: any) {
    let plainPatient = patient.toObject();
    let data = { ...plainPatient, sub: plainPatient._id };
    return {
      accessToken: this.jwtService.sign(data),
    };
  }
}
