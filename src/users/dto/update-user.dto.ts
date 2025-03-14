import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsPhoneNumber,
  IsOptional,
  Min,
  IsNumber,
  IsBoolean,
  IsDate,
} from 'class-validator';
import { Role } from 'src/auth/roles.enum';
import { Branch } from 'src/branches/branch.schema';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  first_name: string;

  @IsString()
  @IsOptional()
  last_name: string;

  @IsString()
  @IsOptional()
  email: string;

  @IsString()
  @IsOptional()
  username: string;

  @IsString()
  @IsOptional()
  password: string;

  @IsString()
  @IsOptional()
  password_text: string;

  @IsString()
  @IsOptional()
  mobile: string;

  @IsString()
  @IsOptional()
  target: number;

  @IsString()
  @IsOptional()
  branch: Branch;

  @IsString()
  @IsOptional()
  otp: string;

  @IsString()
  @IsOptional()
  teamlead: string;

  @IsString()
  @IsOptional()
  admin: string;

  @IsString()
  @IsOptional()
  role: Role;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
