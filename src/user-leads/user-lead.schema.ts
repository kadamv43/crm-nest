import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserLeadDocument = UserLead & Document;

@Schema()
export class UserLead {
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

export const UserLeadSchema = SchemaFactory.createForClass(UserLead);
