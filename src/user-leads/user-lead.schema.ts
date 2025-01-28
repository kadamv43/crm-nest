import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Branch } from 'src/branches/branch.schema';
import { User } from 'src/users/user.schema';

export type UserLeadDocument = UserLead & Document;

@Schema()
export class UserLead {
  @Prop({ required: true, trim: true })
  mobile: string;

  @Prop({ required: false, trim: true })
  name?: string;

  @Prop({ required: false, trim: true })
  assigned_by?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User;

  @Prop({ required: false, trim: true, default: 'FRESH' })
  status?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const UserLeadSchema = SchemaFactory.createForClass(UserLead);
