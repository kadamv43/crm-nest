import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { UserLeadsService } from 'src/user-leads/user-leads.service';
import { UserLeadsModule } from 'src/user-leads/user-leads.module';
import { UsersService } from 'src/users/users.service';
import { UsersModule } from 'src/users/users.module';
import { EmailModule } from 'src/email/email.module';

@Module({
  imports: [UserLeadsModule, UsersModule, EmailModule],
  controllers: [DashboardController],
  providers: [UsersService, UserLeadsService, DashboardService],
})
export class DashboardModule {}
