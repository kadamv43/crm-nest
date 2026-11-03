import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type CampaignDocument = Campaign & Document;
export type CampaignStatus = 'ACTIVE' | 'COMPLETED';

/**
 * A batch of leads rotated through a fixed list of staff. The leads are split
 * into one batch per staff member; every round each batch moves on to the next
 * person, so after as many rounds as there are staff everyone has had every
 * lead once.
 */
@Schema()
export class Campaign {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: any;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, enum: ['ACTIVE', 'COMPLETED'], default: 'ACTIVE' })
  status: CampaignStatus;

  // The staff taking part, in rotation order. Fixed when the campaign starts.
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: 'User', required: true })
  staff: any[];

  // The round the leads are in now (1 = first hand-out).
  @Prop({ default: 1 })
  round: number;

  @Prop({ default: 0 })
  total_leads: number;

  // NORMAL campaigns take leads from the normal pool; HOT ones from the hot
  // pool, and hand them out as hot leads. Missing on older campaigns = NORMAL.
  @Prop({ type: String, enum: ['NORMAL', 'HOT'], default: 'NORMAL' })
  lead_type: 'NORMAL' | 'HOT';

  // Leads in these statuses move to the next person when a new round starts;
  // the others stay with whoever has them. Missing on older campaigns, which
  // use the default (everything except the finished statuses).
  @Prop({ type: [String], required: false })
  move_statuses?: string[];

  // One entry per round after the first: what was chosen and what happened.
  @Prop({ type: [Object], default: [] })
  history: Record<string, any>[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: false })
  created_by?: any;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;

  @Prop({ required: false })
  closed_at?: Date;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);

// two campaigns of a company cannot share a name
CampaignSchema.index({ branch: 1, name: 1 }, { unique: true });
CampaignSchema.index({ branch: 1, created_at: -1 });

/** One lead of a campaign: which batch it is in, and whether it has finished rotating. */
@Schema()
export class CampaignLead {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Campaign', required: true })
  campaign: any;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: any;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Contact', required: true })
  contact: any;

  @Prop({ required: true, trim: true })
  mobile: string;

  @Prop({ required: false, trim: true })
  name?: string;

  @Prop({ required: false, trim: true })
  city?: string;

  // 0-based. Round r hands batch b to staff[(b + r - 1) % staff.length].
  @Prop({ required: true })
  batch: number;

  // reached a final status (paid, not interested, dead): no longer rotates
  @Prop({ default: false })
  done: boolean;
}

export const CampaignLeadSchema = SchemaFactory.createForClass(CampaignLead);

CampaignLeadSchema.index({ campaign: 1, contact: 1 }, { unique: true });
CampaignLeadSchema.index({ campaign: 1, done: 1 });
