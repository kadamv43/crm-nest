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
import { SpotIncentiveService } from './spot-incentive.service';
import { UpdateSpotIncentiveDto } from './dto/update-spot-incentive.dto';

@Controller('spot-incentive')
export class SpotIncentiveController {
  constructor(private readonly service: SpotIncentiveService) {}

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
    @Body() updateSpotIncentiveDto: UpdateSpotIncentiveDto,
  ) {
    return this.service.update(id, updateSpotIncentiveDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id')
  updatePartial(
    @Param('id') id: string,
    @Body() updateSpotIncentiveDto: UpdateSpotIncentiveDto,
  ) {
    return this.service.update(id, updateSpotIncentiveDto);
  }
}
