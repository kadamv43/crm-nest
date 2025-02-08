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

import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { DayOfferService } from './day-offer.service';
import { UpdateDayOfferDto } from './dto/update-day-offer.dto';

@UseGuards(JwtAuthGuard)
@Controller('day-offer')
export class DayOfferController {
  constructor(private readonly service: DayOfferService) {}

  @Post()
  async createBranch(@Body() body, @Req() req: Request) {
    if (req.user['role'] == 'admin') {
      body.branch = req.user['branch']['_id'];
    }
    return this.service.create(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>, @Req() req: Request) {
    if (req.user['role'] == 'admin') {
      query.branch = req.user['branch']['_id'];
    }
    return this.service.findAll(query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateMonthlyIncentiveDto: UpdateDayOfferDto,
  ) {
    return this.service.update(id, updateMonthlyIncentiveDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id')
  updatePartial(
    @Param('id') id: string,
    @Body() updateMonthlyIncentiveDto: UpdateDayOfferDto,
  ) {
    return this.service.update(id, updateMonthlyIncentiveDto);
  }
}
