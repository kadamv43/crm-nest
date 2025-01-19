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
import { UpdateBankDto } from './dto/update-bank.dto';
import { BanksService } from './banks.service';

@Controller('banks')
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @Post()
  async createBranch(@Body() body) {
    return this.banksService.create(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
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
  ) {
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
