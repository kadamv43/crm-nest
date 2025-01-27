import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsDate } from 'class-validator';

export class CreateMonthlyIncentiveDto {
  @IsString()
  @IsNotEmpty()
  business: string;

  @IsString()
  @IsNotEmpty()
  incentive: string;

  @IsString()
  @IsNotEmpty()
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
