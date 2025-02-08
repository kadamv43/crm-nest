import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Request } from 'express';
import { User } from './user.schema';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from 'src/auth/roles.enum';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { AuthGuard } from '@nestjs/passport';
import { EmailService } from 'src/email/email.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private emailService: EmailService,
  ) {}

  @Post()
  // @Roles(Role.Admin)
  async create(@Body() createUserDto: User, @Req() req: Request) {
    return this.usersService.create(createUserDto, req);
  }

  @Get('/')
  findAll(@Query() query: Record<string, any>, @Req() req: Request) {
    if (req.user['role'] == 'admin') {
      query.branch = req.user['branch']['_id'];
    }
    query.IsSuperAdmin = req.user['role'] == 'superadmin';
    return this.usersService.findAll(query);
  }

  @Get('search')
  async findBy(@Query() query: Record<string, any>): Promise<User[]> {
    return this.usersService.findBy(query);
  }

  @Get('user-details')
  @UseGuards(AuthGuard('jwt'))
  getUserDetails(@Req() req: Request) {
    return this.usersService.findOne(req.user['userId']);
    // return JSON.stringify(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: User) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
