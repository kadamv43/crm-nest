import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type ReportMailSettingDocument = ReportMailSetting & Document;
export type ReportMailLogDocument = ReportMailLog & Document;

export type ReportMailStatus = 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

/** The hourly smart-view email of one company. */
@Schema()
export class ReportMailSetting {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: any;

  @Prop({ default: false })
  enabled: boolean;

  // everybody gets the same single message
  @Prop({ type: [String], default: [] })
  recipients: string[];

  // sending hours in India time, both included (9 and 23 = 9:00 AM ... 11:00 PM)
  @Prop({ default: 9 })
  from_hour: number;

  @Prop({ default: 23 })
  to_hour: number;

  // same meaning as the switch on the smart view
  @Prop({ default: false })
  only_logged_in: boolean;

  // send nothing for an hour in which no number changed
  @Prop({ default: false })
  skip_if_unchanged: boolean;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  updated_by?: any;

  // what happened the last time, for the settings page
  @Prop({ required: false })
  last_sent_at?: Date;

  @Prop({ type: String, required: false })
  last_status?: ReportMailStatus | null;

  @Prop({ required: false })
  last_error?: string;

  // fingerprint of the numbers in the last mail (for skip_if_unchanged)
  @Prop({ required: false })
  last_digest?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const ReportMailSettingSchema =
  SchemaFactory.createForClass(ReportMailSetting);

ReportMailSettingSchema.index({ branch: 1 }, { unique: true });

/**
 * One row per company per hour. Claiming the row is what stops the same mail
 * being sent twice, even with two copies of the server or a restart.
 */
@Schema()
export class ReportMailLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: any;

  // the India-time hour this is for, "2025-03-10 14"
  @Prop({ required: true })
  slot: string;

  @Prop({ type: String, required: true })
  status: ReportMailStatus;

  @Prop({ default: 0 })
  recipients_count: number;

  @Prop({ required: false })
  error?: string;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ required: false })
  finished_at?: Date;
}

export const ReportMailLogSchema = SchemaFactory.createForClass(ReportMailLog);

ReportMailLogSchema.index({ branch: 1, slot: 1 }, { unique: true });
// the history is only for the settings page: keep 30 days
ReportMailLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
