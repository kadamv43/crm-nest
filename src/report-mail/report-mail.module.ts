import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BranchSchema } from 'src/branches/branch.schema';
import { AttendanceModule } from 'src/attendance/attendance.module';
import { DashboardModule } from 'src/dashboard/dashboard.module';
import { EmailModule } from 'src/email/email.module';
import { UsersModule } from 'src/users/users.module';
import {
  ReportMailLog,
  ReportMailLogSchema,
  ReportMailSetting,
  ReportMailSettingSchema,
} from './report-mail.schema';
import { ReportMailService } from './report-mail.service';
import { ReportMailScheduler } from './report-mail.scheduler';
import { ReportMailController } from './report-mail.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReportMailSetting.name, schema: ReportMailSettingSchema },
      { name: ReportMailLog.name, schema: ReportMailLogSchema },
      { name: 'Branch', schema: BranchSchema },
    ]),
    UsersModule,
    DashboardModule,
    AttendanceModule,
    EmailModule,
  ],
  providers: [ReportMailService, ReportMailScheduler],
  controllers: [ReportMailController],
  exports: [ReportMailService],
})
export class ReportMailModule {}
