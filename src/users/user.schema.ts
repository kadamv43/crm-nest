import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Role } from 'src/auth/roles.enum';

export type UserDocument = User & Document;

@Schema()
export class User {
  @Prop({ required: true })
  first_name: string;

  @Prop({ required: true })
  last_name: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  username: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: false })
  mobile: string;

  @Prop({ required: false })
  target: number;

  @Prop({ required: false })
  otp: string;

  @Prop({ type: String, enum: Role, default: Role.Employee })
  role: Role;

  @Prop({ default: Date.now })
  created_at: Date;

  @Prop({ default: Date.now })
  updated_at: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre('save', async function (next) {
  const user = this as UserDocument;
  if (!user.isModified('password')) return next();
  const salt = 10;
  user.password = await bcrypt.hash(user.password, salt);
  next();
});
