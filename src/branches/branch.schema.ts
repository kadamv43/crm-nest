import { Document } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type BranchDocument = Branch & Document;

@Schema()
export class Branch {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  address: string;

  @Prop({ required: true, trim: true })
  max_users: number;

  @Prop({ required: true, trim: true, default: 'Active' })
  status: string;

  @Prop({ required: true, default: Date.now })
  expiry_date: Date;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const BranchSchema = SchemaFactory.createForClass(Branch);
