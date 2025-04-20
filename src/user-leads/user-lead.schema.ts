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
  city?: string;

  @Prop({ required: false, trim: true })
  assigned_by?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: Branch;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: User;

  @Prop({ required: false, trim: true, default: 'FRESH' })
  status?: string;

  @Prop({ required: false, default: false })
  is_hot_lead?: boolean;

  @Prop({
    type: Object,
    required: false,
    _id: false,
    properties: {
      name: { type: String, trim: true },
      mobile: { type: String, trim: true },
      city: { type: String, trim: true },
      investment: { type: String, trim: true },
      options: { type: Array, trim: true },
      remark: { type: String, trim: true },
      free_trial_date: { type: Date },
    },
  })
  free_trial: {
    name: string;
    mobile: string;
    city: string;
    investment: string;
    options: object;
    remark: string;
    free_trial_date: Date;
  };

  @Prop({
    type: Object,
    required: false,
    _id: false,
    properties: {
      expected_payment: { type: String, trim: true },
      expected_payment_date: { type: Date },
    },
  })
  follow_up: {
    expected_payment: string;
    expected_payment_date: Date;
  };

  @Prop({
    type: Object,
    required: false,
    _id: false,
    properties: {
      name: { type: String, trim: true },
      mobile: { type: String, trim: true },
      city: { type: String, trim: true },
      callback_date: { type: Date },
    },
  })
  callback: {
    callback_date: Date;
    name: string;
    mobile: string;
    city: string;
  };

  @Prop({
    type: Object,
    required: false,
    _id: false,
    properties: {
      payment_amount: { type: String, trim: true },
      payment_details: { type: Object, trim: true },
      payment_mode: { type: String, trim: true },
      payment_date: { type: Date },
      email_status: { type: String, default: 'Not Done' },
    },
  })
  payment: {
    payment_amount: string;
    payment_details: object;
    payment_mode: string;
    payment_date: Date;
    email_status: string;
  };

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const UserLeadSchema = SchemaFactory.createForClass(UserLead);
