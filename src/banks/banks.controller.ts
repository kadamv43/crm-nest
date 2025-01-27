import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UpdateBankDto } from './dto/update-bank.dto';
import { BanksService } from './banks.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { Request } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('banks')
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @Post()
  async createBranch(@Body() body, @Req() req: Request) {
    if (req.user['role'] == 'admin') {
      body.branch = req.user['branch']['_id'];
    }
    return this.banksService.create(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>, @Req() req: Request) {
    if (req.user['role'] == 'admin') {
      query.branch = req.user['branch']['_id'];
    }
    return this.banksService.findAll(query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.banksService.getById(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBankDto,
    @Req() req: Request,
  ) {
    if (req.user['role'] == 'admin') {
      updateDoctorDto.branch = req.user['branch']['_id'];
    }
    return this.banksService.update(id, updateDoctorDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.banksService.remove(id);
  }

  @Patch(':id')
  updatePartial(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBankDto,
  ) {
    return this.banksService.update(id, updateDoctorDto);
  }
}
