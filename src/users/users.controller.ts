import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
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
  create(@Body() createUserDto: User) {
    return this.usersService.create(createUserDto);
  }

  @Get('/')
  findAll(@Query() query: Record<string, any>) {
    return this.usersService.findAll(query);
  }

  @Get('search')
  async findBy(@Query() query: Record<string, any>): Promise<User[]> {
    return this.usersService.findBy(query);
  }

  // @Patch('update-note')
  // @UseGuards(AuthGuard('jwt'))
  // updateNote(@Request() req, @Body() body: any) {
  //   console.log(req.user);
  //   const { note } = body;
  //   return this.usersService.updateNote(req.user.userId, { note: note });
  //   // return JSON.stringify(req.user);
  // }

  @Get('user-details')
  @UseGuards(AuthGuard('jwt'))
  getUserDetails(@Request() req) {
    return this.usersService.findOne(req.user.userId);
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
