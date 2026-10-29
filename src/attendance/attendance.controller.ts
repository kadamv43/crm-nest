import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from 'src/auth/roles.enum';
import { scopedBranch } from 'src/common/request-context';
import { attendanceDate } from 'src/common/time.util';
import { AttendanceService } from './attendance.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  // Who logged in on a day. Admin sees their own company; superadmin picks one
  // (?branch=) or sees all. Without ?date= it is the current attendance day.
  @Get()
  @Roles(Role.Admin, Role.SuperAdmin)
  async list(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('branch') branch?: string,
  ) {
    if (date !== undefined && date !== '') {
      const valid =
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        !isNaN(new Date(date + 'T00:00:00Z').getTime()) &&
        new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date;
      if (!valid) {
        throw new BadRequestException('date must look like 2025-01-31');
      }
    }
    return this.service.list(
      date || attendanceDate(),
      scopedBranch(req, branch),
    );
  }
}
