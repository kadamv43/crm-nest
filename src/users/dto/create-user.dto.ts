import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsDate } from 'class-validator';
import { Role } from 'src/auth/roles.enum';
import { Branch } from 'src/branches/branch.schema';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  @IsString()
  @IsNotEmpty()
  password_text: string;

  @IsString()
  @IsNotEmpty()
  mobile: string;

  @IsString()
  @IsNotEmpty()
  target: number;

  @IsString()
  @IsOptional()
  branch: Branch;

  @IsString()
  @IsOptional()
  otp: string;

  @IsString()
  @IsOptional()
  teamlead: string;

  @IsString()
  @IsOptional()
  admin: string;

  @IsString()
  @IsNotEmpty()
  role: Role;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  created_at?: Date = new Date();

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  updated_at?: Date = new Date();
}
