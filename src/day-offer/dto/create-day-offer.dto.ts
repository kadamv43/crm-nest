import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsDate } from 'class-validator';

export class CreateDayOfferDto {
  @IsString()
  @IsNotEmpty()
  business: string;

  @IsString()
  @IsNotEmpty()
  incentive: string;

  @IsString()
  @IsNotEmpty()
  role: string;

  @IsString()
  @IsNotEmpty()
  branch: string;

  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  offer_start_date?: Date = new Date();

  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  offer_end_date?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
