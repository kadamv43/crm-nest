import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Branch } from 'src/branches/branch.schema';

export type DayOfferDocument = DayOffer & Document;

@Schema()
export class DayOffer {
  @Prop({ required: true, trim: true })
  business: string;

  @Prop({ required: true, trim: true })
  incentive: string;

  @Prop({ required: true, trim: true })
  role: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ required: true })
  offer_start_date: Date;

  @Prop({ required: true })
  offer_end_date: Date;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const DayOfferSchema = SchemaFactory.createForClass(DayOffer);
