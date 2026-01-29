import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard';
import { UsersModule } from 'src/users/users.module';
import { UserGuard } from './guards/user.guad';
import { PatientGuard } from './guards/patient.guard';

import { JwtStrategy } from './strategies/jwt.strategy';
import { HttpModule } from '@nestjs/axios';
import { OtpModule } from 'src/otp/otp.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: 'abc123',
      signOptions: { expiresIn: '10h' },
    }),
    UsersModule,
    OtpModule,
    HttpModule
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, PatientGuard],
})
export class AuthModule {}
