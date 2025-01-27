import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type SpotIncentiveDocument = SpotIncentive & Document;

@Schema()
export class SpotIncentive {
  @Prop({ required: true, trim: true })
  business: string;

  @Prop({ required: true, trim: true })
  incentive: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const SpotIncentiveSchema = SchemaFactory.createForClass(SpotIncentive);
