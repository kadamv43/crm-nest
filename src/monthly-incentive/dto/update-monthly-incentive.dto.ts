import { Type } from 'class-transformer';
import { IsString, IsOptional, IsDate, IsNotEmpty } from 'class-validator';

export class UpdateMonthlyIncentiveDto {
  @IsString()
  @IsOptional()
  business: string;

  @IsString()
  @IsOptional()
  incentive: string;

  @IsString()
  @IsOptional()
  role: string;

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
