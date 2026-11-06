import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Branch } from 'src/branches/branch.schema';
import { Contact } from 'src/contacts/contact.schema';
import { User } from 'src/users/user.schema';

export type HotLeadDocument = HotLead & Document;

@Schema()
export class HotLead {
  // The person this row is about. The number itself is stored once, on the contact.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Contact', required: true })
  contact: Contact;

  // Read-only copy of contact.mobile so lists and search keep working
  // without a join. Always written together with `contact`.
  @Prop({ required: true, trim: true })
  mobile: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  uploaded_by?: User;

  @Prop({ required: false, trim: true })
  name?: string;

  @Prop({ required: false, trim: true })
  city?: string;

  @Prop({ required: false, trim: true })
  investment?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const HotLeadSchema = SchemaFactory.createForClass(HotLead);

// A number waits in a company's hot-lead pool only once. Rows from before
// contacts existed have no contact and must not block the index.
HotLeadSchema.index(
  { branch: 1, contact: 1 },
  { unique: true, partialFilterExpression: { contact: { $exists: true } } },
);
HotLeadSchema.index({ branch: 1, created_at: -1 });
