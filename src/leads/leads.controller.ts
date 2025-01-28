import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { LeadsService } from './leads.service';
import { UpdateLeadDto } from './dto/update-lead.dto';

@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Post()
  async createBranch(@Body() body) {
    const { mobile } = body;
    const mobileArray = mobile.split('\n');
    const data = mobileArray.map((item) => {
      return {
        mobile: item,
      };
    });
    return this.service.create(data);
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
  async update(@Param('id') id: string, @Body() updateDto: UpdateLeadDto) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id')
  updatePartial(@Param('id') id: string, @Body() updateDto: UpdateLeadDto) {
    return this.service.update(id, updateDto);
  }

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet);
    console.log(jsonData);
    return await this.service.insertData(jsonData);
  }
}
