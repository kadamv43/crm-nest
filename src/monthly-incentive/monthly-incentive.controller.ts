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
} from '@nestjs/common';

import { MonthlyIncentiveService } from './monthly-incentive.service';
import { UpdateMonthlyIncentiveDto } from './dto/update-monthly-incentive.dto';

@Controller('monthly-incentive')
export class MonthlyIncentiveController {
  constructor(private readonly service: MonthlyIncentiveService) {}

  @Post()
  async createBranch(@Body() body) {
    return this.service.create(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateMonthlyIncentiveDto: UpdateMonthlyIncentiveDto,
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
    @Body() updateMonthlyIncentiveDto: UpdateMonthlyIncentiveDto,
  ) {
    return this.service.update(id, updateMonthlyIncentiveDto);
  }
}
