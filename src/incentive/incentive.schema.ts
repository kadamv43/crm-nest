import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Branch } from 'src/branches/branch.schema';
import { User } from 'src/users/user.schema';

export type IncentiveDocument = Incentive & Document;

@Schema()
export class Incentive {
  @Prop({ required: true, trim: true })
  business: string;

  @Prop({ required: true, trim: true })
  incentive_type: string;

  @Prop({ required: true, type: Object })
  incentive: Record<string, any>;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const IncentiveSchema = SchemaFactory.createForClass(Incentive);
