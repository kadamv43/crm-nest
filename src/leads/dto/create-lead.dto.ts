import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsDate } from 'class-validator';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  mobile: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  city: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
