import { Type } from 'class-transformer';
import { IsString, IsOptional, IsDate } from 'class-validator';

export class UpdateSpotIncentiveDto {
  @IsString()
  @IsOptional()
  business: string;

  @IsString()
  @IsOptional()
  incentive: string;

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
