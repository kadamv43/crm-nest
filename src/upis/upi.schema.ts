import { Document, Schema as MongooseSchema } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Branch } from 'src/branches/branch.schema';

export type UpiDocument = Upi & Document;

@Schema()
export class Upi {
  @Prop({ required: true, trim: true })
  upi_id: string;

  @Prop({ required: true, trim: true })
  upi_number: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const UpiSchema = SchemaFactory.createForClass(Upi);
