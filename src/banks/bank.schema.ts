import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Branch } from 'src/branches/branch.schema';

export type BankDocument = Bank & Document;

@Schema()
export class Bank {
  @Prop({ required: true, trim: true })
  account_holder: string;

  @Prop({ required: true, trim: true })
  account_number: string;

  @Prop({ required: true, trim: true })
  bank_name: string;

  @Prop({ required: true, trim: true })
  ifsc_code: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const BankSchema = SchemaFactory.createForClass(Bank);
