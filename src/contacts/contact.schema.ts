import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Branch } from 'src/branches/branch.schema';

export type ContactDocument = Contact & Document;

/**
 * One person / phone number per company. This is the only place a mobile
 * number is stored as an identity: leads, hot leads and the staff's calling
 * rows all point here with `contact`, so the same number uploaded again and
 * again still counts as one contact.
 */
@Schema()
export class Contact {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  // 10 digits, see normalizeMobile()
  @Prop({ required: true, trim: true })
  mobile: string;

  @Prop({ required: false, trim: true })
  name?: string;

  @Prop({ required: false, trim: true })
  city?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);

// The rule that makes "unique leads" true: one contact per company and number.
ContactSchema.index({ branch: 1, mobile: 1 }, { unique: true });
