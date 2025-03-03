import { Module } from '@nestjs/common';
import { UserLeadsService } from './user-leads.service';
import { UserLeadsController } from './user-leads.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { UserLead, UserLeadSchema } from './user-lead.schema';
import { LeadsService } from 'src/leads/leads.service';
import { LeadsModule } from 'src/leads/leads.module';
import { HotLeadsService } from 'src/hot-leads/hot-leads.service';
import { HotLeadsModule } from 'src/hot-leads/hot-leads.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserLead.name, schema: UserLeadSchema },
    ]),
    LeadsModule,
    HotLeadsModule,
  ],
  exports: [UserLeadsService, MongooseModule],
  providers: [UserLeadsService, LeadsService, HotLeadsService],
  controllers: [UserLeadsController],
})
export class UserLeadsModule {}
