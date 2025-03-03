import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDate,
  isObject,
  IsBoolean,
} from 'class-validator';

export class CreateUserLeadDto {
  @IsString()
  @IsNotEmpty()
  mobile: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  assigned_by: string;

  @IsString()
  @IsNotEmpty()
  user: string;

  @IsString()
  @IsNotEmpty()
  branch: string;

  @IsString()
  @IsNotEmpty()
  status: string;

  @IsBoolean()
  @IsOptional()
  is_hot_lead: boolean;

  @IsOptional()
  free_trial: any;

  @IsOptional()
  callback: any;

  @IsOptional()
  follow_up: any;

  @IsOptional()
  payment: any;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
