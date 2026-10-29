import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type AttendanceDocument = Attendance & Document;

/**
 * One row per person per attendance day: when they first logged in.
 * The day starts at 8 AM India time (see attendanceDate()).
 */
@Schema()
export class Attendance {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  user: any;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Branch', required: true })
  branch: any;

  // attendance day, "YYYY-MM-DD" in India time
  @Prop({ required: true })
  date: string;

  @Prop({ required: true })
  first_login_at: Date;

  @Prop({ required: true })
  last_login_at: Date;

  @Prop({ default: 0 })
  login_count: number;
}

export const AttendanceSchema = SchemaFactory.createForClass(Attendance);

// One attendance row per person per day.
AttendanceSchema.index({ user: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ branch: 1, date: 1 });
