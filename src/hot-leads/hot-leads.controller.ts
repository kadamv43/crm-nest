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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { readSheetRows } from 'src/common/excel.util';
import { requestContext, scopedBranch } from 'src/common/request-context';
import { HotLeadsService } from './hot-leads.service';
import { UpdateHotLeadDto } from './dto/update-hot-lead.dto';

@UseGuards(JwtAuthGuard)
@Controller('hot-leads')
export class HotLeadsController {
  constructor(private readonly service: HotLeadsService) {}

  // One hot lead from the form: mobile, name, city, investment.
  @Post()
  async createBranch(@Body() body, @Req() req: Request) {
    const ctx = requestContext(req);
    return this.service.ingest(
      { branch: ctx.branch, uploadedBy: ctx.userId },
      [body ?? {}],
    );
  }

  // Excel upload with columns mobile, name, city, investment.
  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    const ctx = requestContext(req);
    return this.service.ingest(
      { branch: ctx.branch, uploadedBy: ctx.userId },
      readSheetRows(file),
    );
  }

  @Post('delete-bulk')
  async deleteBulk(@Body() body, @Req() req: Request) {
    const leadIds = (body?.leads ?? []).map((item) => item?._id);
    return this.service.deleteByIds(leadIds, scopedBranch(req));
  }

  @Get()
  async findAll(@Query() query: Record<string, any>, @Req() req: Request) {
    return this.service.findAll(query, scopedBranch(req, query?.branch));
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string, @Req() req: Request) {
    return this.service.getById(id, scopedBranch(req));
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateHotLeadDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, updateDto, scopedBranch(req));
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    return this.service.remove(id, scopedBranch(req));
  }

  @Patch(':id')
  updatePartial(
    @Param('id') id: string,
    @Body() updateDto: UpdateHotLeadDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, updateDto, scopedBranch(req));
  }
}
