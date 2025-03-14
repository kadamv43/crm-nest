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
import { UpdateUserLeadDto } from './dto/update-user-lead.dto';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { LeadsService } from 'src/leads/leads.service';
import { UserHotLeadsService } from './user-hot-leads.service';
import { HotLeadsService } from 'src/hot-leads/hot-leads.service';

@UseGuards(JwtAuthGuard)
@Controller('user-hot-leads')
export class UserHotLeadsController {
  constructor(
    private readonly service: UserHotLeadsService,
    private hotLeadsService: HotLeadsService,
  ) {}

  @Post()
  async create(@Body() body, @Req() req: Request) {
    const { mobile, user } = body;

    // Split, trim, and remove empty values
    const mobileArray = mobile
      .split('\n')
      .map((item) => item.trim()) // Remove extra spaces
      .filter((item) => item); // Remove empty entries

    // Remove duplicates
    const uniqueMobiles = [...new Set(mobileArray)];

    // Prepare data for insertion
    const data: any = uniqueMobiles.map((mobile) => ({
      mobile,
      user,
      assigned_by: req.user['username'],
      branch: req.user['branch']['_id'],
    }));

    // Insert only unique mobile numbers
    return this.service.create(data);
  }

  @Post('bulk')
  async createBulk(@Body() body, @Req() req: Request) {
    const { leads, user } = body;

    const leadIds = leads.map((item) => item?._id).filter((id) => id); // Ensures no undefined/null values

    const data = leads.map((item) => {
      return {
        mobile: item?.mobile,
        name: item?.name,
        city: item?.city,
        user,
        assigned_by: req.user['username'],
        branch: req.user['branch']['_id'],
      };
    });
    await this.service.create(data);
    return this.hotLeadsService.deleteByIds(leadIds); // No need for await before return
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.service.findAll(query);
  }

  @Get('my-leads')
  async getMyLeads(@Req() req: Request, @Query() query: Record<string, any>) {
    return this.service.getByUserId(req?.user['userId'], query);
  }

  @Get('last-week-free-trials')
  async lastWeekFreeTrials(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    return this.service.getFreeTrialDataLastWeek(req?.user['userId'], query);
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
    return await this.service.insertData(jsonData);
  }
}
