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
import { readSheetRows, rowsFromPastedText } from 'src/common/excel.util';
import { requestContext, scopedBranch } from 'src/common/request-context';
import { LeadsService } from './leads.service';
import { UpdateLeadDto } from './dto/update-lead.dto';

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly service: LeadsService) {}

  // Paste box: one number per line. Returns what was added and what was skipped.
  @Post()
  async createBranch(@Body() body, @Req() req: Request) {
    const ctx = requestContext(req);
    return this.service.ingest(
      { branch: ctx.branch, uploadedBy: ctx.userId },
      rowsFromPastedText(body?.mobile),
    );
  }

  // Excel upload with columns mobile, name, city.
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
    @Body() updateDto: UpdateLeadDto,
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
    @Body() updateDto: UpdateLeadDto,
    @Req() req: Request,
  ) {
    return this.service.update(id, updateDto, scopedBranch(req));
  }
}
