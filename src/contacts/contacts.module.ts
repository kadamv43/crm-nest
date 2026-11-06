import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contact, ContactSchema } from './contact.schema';
import { LeadActivity, LeadActivitySchema } from './lead-activity.schema';
import { ContactsService } from './contacts.service';
import { LeadActivityService } from './lead-activity.service';
import { ContactsController } from './contacts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: LeadActivity.name, schema: LeadActivitySchema },
    ]),
  ],
  providers: [ContactsService, LeadActivityService],
  controllers: [ContactsController],
  exports: [ContactsService, LeadActivityService, MongooseModule],
})
export class ContactsModule {}
