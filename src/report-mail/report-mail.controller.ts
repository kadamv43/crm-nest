import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from 'src/auth/roles.enum';
import { scopedBranch } from 'src/common/request-context';
import { ReportMailService } from './report-mail.service';

// An admin manages the hourly mail of their own company; superadmin of any.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('report-mail')
export class ReportMailController {
  constructor(private readonly service: ReportMailService) {}

  private company(req: Request, requested?: string): string {
    const branch = scopedBranch(req, requested);
    if (!branch || !Types.ObjectId.isValid(branch)) {
      throw new BadRequestException('branch is required');
    }
    return branch;
  }

  @Get('settings')
  @Roles(Role.Admin, Role.SuperAdmin)
  settings(@Req() req: Request, @Query('branch') branch?: string) {
    return this.service.getSettings(this.company(req, branch));
  }

  @Put('settings')
  @Roles(Role.Admin, Role.SuperAdmin)
  save(@Req() req: Request, @Body() body: any, @Query('branch') branch?: string) {
    return this.service.saveSettings(
      this.company(req, branch),
      body ?? {},
      (req.user as any)?.userId,
    );
  }

  @Post('test')
  @Roles(Role.Admin, Role.SuperAdmin)
  test(@Req() req: Request, @Query('branch') branch?: string) {
    return this.service.sendTest(this.company(req, branch));
  }

  @Get('logs')
  @Roles(Role.Admin, Role.SuperAdmin)
  logs(@Req() req: Request, @Query('branch') branch?: string) {
    return this.service.recentLogs(this.company(req, branch));
  }
}
