import { Type } from 'class-transformer';
import { IsString, IsOptional, IsDate, IsBoolean } from 'class-validator';

export class UpdateUserLeadDto {
  @IsString()
  @IsOptional()
  mobile: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  assigned_by: string;

  @IsString()
  @IsOptional()
  user: string;

  @IsString()
  @IsOptional()
  branch: string;

  @IsOptional()
  callback: any;

  @IsBoolean()
  @IsOptional()
  is_hot_lead: boolean;

  @IsString()
  @IsOptional()
  status: string;

  @IsOptional()
  free_trial: any;

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
