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

export class UpdateBranchDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsNumber()
  @IsOptional()
  spot_incentive_base_business: number;

  @IsNumber()
  @IsOptional()
  max_users: number;

  @IsString()
  @IsOptional()
  status: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expiry_date: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
