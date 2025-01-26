import { Module } from '@nestjs/common';
import { UserLeadsService } from './user-leads.service';
import { UserLeadsController } from './user-leads.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { UserLead, UserLeadSchema } from './user-lead.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserLead.name, schema: UserLeadSchema },
    ]),
  ],
  providers: [UserLeadsService],
  controllers: [UserLeadsController],
})
export class UserLeadsModule {}
