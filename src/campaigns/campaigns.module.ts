import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceModule } from 'src/attendance/attendance.module';
import { ContactsModule } from 'src/contacts/contacts.module';
import { Lead, LeadSchema } from 'src/leads/lead.schema';
import { UserLead, UserLeadSchema } from 'src/user-leads/user-lead.schema';
import { UsersModule } from 'src/users/users.module';
import {
  Campaign,
  CampaignLead,
  CampaignLeadSchema,
  CampaignSchema,
} from './campaign.schema';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignLead.name, schema: CampaignLeadSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: UserLead.name, schema: UserLeadSchema },
    ]),
    ContactsModule,
    UsersModule,
    AttendanceModule,
  ],
  providers: [CampaignsService],
  controllers: [CampaignsController],
  exports: [CampaignsService],
})
export class CampaignsModule {}
