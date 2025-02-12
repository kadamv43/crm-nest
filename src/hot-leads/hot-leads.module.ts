import { Module } from '@nestjs/common';
import { HotLeadsController } from './hot-leads.controller';
import { HotLeadsService } from './hot-leads.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Bank } from 'src/banks/bank.schema';
import { HotLead, HotLeadSchema } from './hot-lead.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: HotLead.name, schema: HotLeadSchema }]),
  ],
  exports: [MongooseModule, HotLeadsService],
  controllers: [HotLeadsController],
  providers: [HotLeadsService],
})
export class HotLeadsModule {}
