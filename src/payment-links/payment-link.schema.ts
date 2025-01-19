import { Document, Schema as MongooseSchema } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Branch } from 'src/branches/branch.schema';

export type PaymentLinkDocument = PaymentLink & Document;

@Schema()
export class PaymentLink {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  link: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const PaymentLinkSchema = SchemaFactory.createForClass(PaymentLink);
