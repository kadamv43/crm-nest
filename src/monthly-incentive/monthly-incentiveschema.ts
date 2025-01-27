import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type MonthlyIncentiveDocument = MonthlyIncentive & Document;

@Schema()
export class MonthlyIncentive {
  @Prop({ required: true, trim: true })
  business: string;

  @Prop({ required: true, trim: true })
  incentive: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const MonthlyIncentiveSchema =
  SchemaFactory.createForClass(MonthlyIncentive);
