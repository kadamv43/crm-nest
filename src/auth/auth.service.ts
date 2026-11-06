import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthPayloadDto } from './dto/auth.dto';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import * as bcrypt from 'bcrypt';
import { Branch } from 'src/branches/branch.schema';
import { Role } from './roles.enum';
import { AttendanceService } from 'src/attendance/attendance.service';
import { nextAutoLogout } from 'src/common/time.util';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private attendanceService: AttendanceService,
  ) {}

  async validateUser(username: string, password: string) {
    const user = await this.usersService.findByField({ username });
    if (user && (await bcrypt.compare(password, user.password))) {
      return user;
    }
    throw new UnauthorizedException('Invalid credentials');
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

    // Everyone is logged out at 11 PM India time: the token simply stops
    // being valid then. Logging in after 11 PM is allowed and lasts until the
    // next 11 PM.
    const now = new Date();
    const expiresAt = nextAutoLogout(now);
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: Math.max(
        1,
        Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      ),
    });

    // Attendance: the first login of the 8 AM-to-8 AM day. Superadmin is not
    // staff. A problem here must never stop someone from logging in.
    if (user.role !== 'superadmin') {
      try {
        await this.attendanceService.recordLogin(
          String(user._id),
          String(payload.branch?._id ?? payload.branch),
          now,
        );
      } catch (err) {
        this.logger.error(`could not record attendance: ${err}`);
      }
    }

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      serverTime: now.toISOString(),
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
