import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type LeadActivityDocument = LeadActivity & Document;

export type LeadActivityType = 'ASSIGNED' | 'STATUS_UPDATE';
export type LeadActivitySource = 'LEAD' | 'HOT_LEAD';

/**
 * One line per thing that happened to a contact: handed to a staff member,
 * or the staff member worked it and set a status. Answers "who called whom,
 * and how many times".
 */
@Schema()
export class LeadActivity {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Contact', required: true })
  contact: any;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: any;

  // the staff member the lead is with
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: any;

  // who did it (the assigning admin/TL, or the staff member themself)
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  actor?: any;

  @Prop({ type: String, enum: ['ASSIGNED', 'STATUS_UPDATE'], required: true })
  type: LeadActivityType;

  @Prop({ type: String, enum: ['LEAD', 'HOT_LEAD'], required: true })
  source: LeadActivitySource;

  // the calling row (UserLead / UserHotLead) this belongs to
  @Prop({ type: MongooseSchema.Types.ObjectId, required: false })
  lead?: any;

  @Prop({ required: false })
  from_status?: string;

  @Prop({ required: false })
  to_status?: string;

  @Prop({ default: Date.now })
  created_at: Date;
}

export const LeadActivitySchema = SchemaFactory.createForClass(LeadActivity);

LeadActivitySchema.index({ contact: 1, created_at: -1 });
LeadActivitySchema.index({ branch: 1, created_at: -1 });
LeadActivitySchema.index({ user: 1, created_at: -1 });
