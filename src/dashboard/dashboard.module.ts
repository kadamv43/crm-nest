import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { UserLeadsService } from 'src/user-leads/user-leads.service';
import { UserLeadsModule } from 'src/user-leads/user-leads.module';
import { ContactsModule } from 'src/contacts/contacts.module';
import { UsersService } from 'src/users/users.service';
import { UsersModule } from 'src/users/users.module';
import { EmailModule } from 'src/email/email.module';
import { AttendanceModule } from 'src/attendance/attendance.module';
import { SmartViewService } from './smart-view.service';

@Module({
  imports: [
    ContactsModule,
    UserLeadsModule,
    UsersModule,
    EmailModule,
    AttendanceModule,
  ],
  controllers: [DashboardController],
  providers: [UsersService, UserLeadsService, DashboardService, SmartViewService],
  exports: [SmartViewService],
})
export class DashboardModule {}
