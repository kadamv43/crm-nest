import { Type } from 'class-transformer';
import { IsString, IsOptional, IsDate } from 'class-validator';

export class UpdateHotLeadDto {
  @IsString()
  @IsOptional()
  mobile: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  city: string;

  @IsString()
  @IsOptional()
  investment: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
