import { Type } from 'class-transformer';
import { IsString, IsOptional, IsDate } from 'class-validator';

export class UpdateBankDto {
  @IsString()
  @IsOptional()
  account_holder: string;

  @IsString()
  @IsOptional()
  account_number: string;

  @IsString()
  @IsOptional()
  bank_name: string;

  @IsString()
  @IsOptional()
  ifsc_code: string;

  @IsString()
  @IsOptional()
  branch: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
