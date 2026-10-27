import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from './lead.schema';
import { ContactsModule } from 'src/contacts/contacts.module';

@Module({
  imports: [
    ContactsModule,
    MongooseModule.forFeature([{ name: Lead.name, schema: LeadSchema }]),
  ],
  providers: [LeadsService],
  exports: [MongooseModule, LeadsService],
  controllers: [LeadsController],
})
export class LeadsModule {}
