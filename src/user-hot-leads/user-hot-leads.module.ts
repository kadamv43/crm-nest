import { Module } from '@nestjs/common';
import { UserHotLeadsController } from './user-hot-leads.controller';
import { UserHotLeadsService } from './user-hot-leads.service';
import { LeadsModule } from 'src/leads/leads.module';
import { MongooseModule } from '@nestjs/mongoose';
import { UserHotLead, UserHotLeadSchema } from './user-hot-lead.schema';
import { LeadsService } from 'src/leads/leads.service';
import { HotLeadsService } from 'src/hot-leads/hot-leads.service';
import { HotLeadsModule } from 'src/hot-leads/hot-leads.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserHotLead.name, schema: UserHotLeadSchema },
    ]),
    HotLeadsModule,
  ],
  exports: [UserHotLeadsService, MongooseModule],
  controllers: [UserHotLeadsController],
  providers: [UserHotLeadsService, HotLeadsService],
})
export class UserHotLeadsModule {}
