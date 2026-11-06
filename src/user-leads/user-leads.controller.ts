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
import { readSheetRows, rowsFromPastedText } from 'src/common/excel.util';
import { requestContext, scopedBranch } from 'src/common/request-context';
import { UserLeadsService } from './user-leads.service';
import { UpdateUserLeadDto } from './dto/update-user-lead.dto';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { LeadsService } from 'src/leads/leads.service';
import { HotLeadsService } from 'src/hot-leads/hot-leads.service';

@UseGuards(JwtAuthGuard)
@Controller('user-leads')
export class UserLeadsController {
  constructor(
    private readonly service: UserLeadsService,
    private leadService: LeadsService,
    private hotLeadService: HotLeadsService,
  ) {}

  // Pasted numbers (one per line) handed straight to one staff member.
  @Post()
  async create(@Body() body, @Req() req: Request) {
    const { mobile, user } = body ?? {};
    if (!user) {
      throw new BadRequestException('Please select a user');
    }
    const ctx = requestContext(req);
    return this.service.assignMobiles(
      { branch: ctx.branch, actorId: ctx.userId, actorName: ctx.username },
      user,
      rowsFromPastedText(mobile),
    );
  }

  // Pool rows (or a repeat payment) handed to a staff member; handed-out pool entries are removed.
  @Post('bulk')
  async createBulk(@Body() body, @Req() req: Request) {
    const { leads, user } = body;
    const ctx = requestContext(req);

    const leadIds = leads.map((item) => item?._id).filter((id) => id);

    const data = leads.map((item) => {
      if (item?.payment?.payment_date) {
        item.payment.payment_date = new Date(item?.payment?.payment_date);
      }

      return {
        contact: item?.contact,
        mobile: item?.mobile,
        name: item?.name,
        city: item?.city,
        user,
        status: item?.status,
        payment: item?.payment,
        is_hot_lead: item?.is_hot_lead ? item?.is_hot_lead : false,
        assigned_by: ctx.username,
      };
    });
    await this.service.assign(
      { branch: ctx.branch, actorId: ctx.userId, actorName: ctx.username },
      data,
    );

    if (data[0]?.is_hot_lead) {
      return this.hotLeadService.deleteByIds(leadIds, ctx.branch);
    } else {
      return this.leadService.deleteByIds(leadIds, ctx.branch);
    }
  }

  @Post('delete-bulk')
  async deleteBulk(@Body() body, @Req() req: Request) {
    const { leads } = body;
    const leadIds = leads.map((item) => item?._id);
    return this.service.deleteByIds(leadIds);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.service.findAll(query);
  }

  @Get('my-leads')
  async getMyLeads(@Req() req: Request, @Query() query: Record<string, any>) {
    return this.service.getByUserId(req?.user['userId'], query);
  }

  @Get('my-hot-leads')
  async getMyHotLeads(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    return this.service.getByUserIdHotLeads(req?.user['userId'], query);
  }

  @Get('assigned-hot-leads')
  async getAssignedHotLeads(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    // each company only ever sees its own leads; superadmin may pick one with ?branch=
    return this.service.getAssigneddHotLeads(
      req?.user['userId'],
      query,
      scopedBranch(req, query?.branch),
    );
  }

  @Get('assigned-leads')
  async getAssignedLeads(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    // each company only ever sees its own leads; superadmin may pick one with ?branch=
    return this.service.getAssignedLeads(
      req?.user['userId'],
      query,
      scopedBranch(req, query?.branch),
    );
  }

  @Get('get-lead-history')
  async getLeadHistory(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    return this.service.getLeadHistory(query, scopedBranch(req));
  }

  @Get('my-follow-up')
  async getMyFollowUp(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    return this.service.getByUserIdFollowUp(req?.user['userId'], query);
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
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateUserLeadDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, updateDto, req?.user['userId']);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id')
  updatePartial(
    @Param('id') id: string,
    @Body() updateDto: UpdateUserLeadDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, updateDto, req?.user['userId']);
  }

  // Excel of numbers for staff. Columns: mobile, user (staff id), optional name, city, status.
  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const rows = readSheetRows(file);
    if (rows.some((row) => !row.user)) {
      throw new BadRequestException('Every row needs a user column');
    }
    const ctx = requestContext(req);
    const created = await this.service.assign(
      { branch: ctx.branch, actorId: ctx.userId, actorName: ctx.username },
      rows.map((row) => ({
        mobile: row.mobile,
        name: row.name || undefined,
        city: row.city || undefined,
        user: String(row.user),
        status: row.status || undefined,
        assigned_by: ctx.username,
      })),
    );
    return { message: 'Data inserted successfully', insertedData: created };
  }
}
