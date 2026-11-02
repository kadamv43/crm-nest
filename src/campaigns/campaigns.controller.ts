import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Types } from 'mongoose';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from 'src/auth/roles.enum';
import { readSheetRows } from 'src/common/excel.util';
import { scopedBranch } from 'src/common/request-context';
import { CampaignsService } from './campaigns.service';

// Admin runs the campaigns of their own company; superadmin of any (?branch=).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  private company(req: Request, requested?: string): string {
    const branch = scopedBranch(req, requested);
    if (!branch || !Types.ObjectId.isValid(branch)) {
      throw new BadRequestException('branch is required');
    }
    return branch;
  }

  private ctx(req: Request, branch: string) {
    const user: any = req.user;
    return { branch, actorId: String(user.userId), actorName: user.username };
  }

  @Get()
  @Roles(Role.Admin, Role.SuperAdmin)
  list(@Req() req: Request, @Query('branch') branch?: string) {
    return this.service.list(this.company(req, branch));
  }

  @Get('options')
  @Roles(Role.TeamLead, Role.Admin, Role.SuperAdmin)
  options(@Req() req: Request, @Query('branch') branch?: string) {
    return this.service.options(this.company(req, branch));
  }

  @Get('staff')
  @Roles(Role.Admin, Role.SuperAdmin)
  staff(@Req() req: Request, @Query('branch') branch?: string) {
    return this.service.staffList(this.company(req, branch));
  }

  @Get(':id')
  @Roles(Role.Admin, Role.SuperAdmin)
  detail(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('branch') branch?: string,
  ) {
    return this.service.detail(id, this.company(req, branch));
  }

  @Post()
  @Roles(Role.Admin, Role.SuperAdmin)
  create(
    @Req() req: Request,
    @Body() body: any,
    @Query('branch') branch?: string,
  ) {
    const company = this.company(req, branch);
    return this.service.create(this.ctx(req, company), body ?? {});
  }

  @Post('import-excel')
  @Roles(Role.Admin, Role.SuperAdmin)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  createFromExcel(
    @Req() req: Request,
    @Body() body: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('branch') branch?: string,
  ) {
    const company = this.company(req, branch);
    let staff: any;
    try {
      staff = typeof body?.staff === 'string' ? JSON.parse(body.staff) : body?.staff;
    } catch {
      throw new BadRequestException('The selected staff list is invalid');
    }

    return this.service.create(this.ctx(req, company), {
      name: body?.name,
      staff,
      leads: readSheetRows(file),
      move_statuses: body?.move_statuses,
      lead_type: body?.lead_type,
    });
  }

  @Post(':id/next-round')
  @Roles(Role.Admin, Role.SuperAdmin)
  next(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('branch') branch?: string,
  ) {
    const company = this.company(req, branch);
    return this.service.nextRound(id, this.ctx(req, company));
  }

  @Post(':id/close')
  @Roles(Role.Admin, Role.SuperAdmin)
  close(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('branch') branch?: string,
  ) {
    return this.service.close(id, this.company(req, branch));
  }
}
