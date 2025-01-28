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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { UserLeadsService } from './user-leads.service';
import { UpdateUserLeadDto } from './dto/update-user-lead.dto';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';

@UseGuards(JwtAuthGuard)
@Controller('user-leads')
export class UserLeadsController {
  constructor(private readonly service: UserLeadsService) {}

  @Post()
  async createBranch(@Body() body, @Req() req: Request) {
    const { mobile, user } = body;
    const mobileArray = mobile.split('\n');
    const data = mobileArray.map((item) => {
      return {
        mobile: item,
        user,
        assigned_by: req.user['username'],
        branch: req.user['branch']['_id'],
      };
    });
    return this.service.create(data);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.service.findAll(query);
  }

  @Get('my-leads')
  async getMyLeads(@Req() req: Request, @Query() query: Record<string, any>) {
    console.log(req.user);
    console.log(query);
    return this.service.getByUserId(req?.user['userId'], query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Get('user/:id')
  async getUserLeads(
    @Param('id') id: string,
    @Query() query: Record<string, any>,
  ) {
    return this.service.getByUserId(id, query);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateDto: UpdateUserLeadDto) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id')
  updatePartial(@Param('id') id: string, @Body() updateDto: UpdateUserLeadDto) {
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
