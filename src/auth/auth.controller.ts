import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { OtpService } from 'src/otp/otp.service';
import { UsersService } from 'src/users/users.service';
import { User } from 'src/users/user.schema';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private otpService: OtpService,
    private userService: UsersService,
  ) {}

  @Post('login')
  async loginUser(@Body() loginDto: { username: string; password: string }) {
    const user = await this.authService.validateUser(
      loginDto.username,
      loginDto.password,
    );
    return this.authService.loginUser(user);
  }


  @Get('details')
  @UseGuards(AuthGuard('jwt'))
  status(@Request() req) {
    return JSON.stringify(req.user);
  }


  @Get('email/search')
  async findBy(@Query() query: Record<string, any>): Promise<User[]> {
    return this.userService.findBy(query);
  }

  @Get('forgot-password/:id')
  async forgotPassword(@Param('id') id: string) {
    return this.userService.forgotPasswordEmail(id);
  }

  @Post('reset-password/:id')
  resetPassword(@Param('id') id: string, @Body() body: any) {
    return this.userService.resetPassword(id, body);
  }
}
