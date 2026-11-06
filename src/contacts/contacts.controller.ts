import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { scopedBranch } from 'src/common/request-context';
import { ContactsService } from './contacts.service';
import { LeadActivityService } from './lead-activity.service';

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly activity: LeadActivityService,
  ) {}

  // Total unique leads. Superadmin without ?branch= also gets it per company.
  @Get('stats')
  async stats(@Req() req: Request, @Query('branch') branch?: string) {
    const scope = scopedBranch(req, branch);
    const total_unique_leads = await this.contacts.countUnique(scope);
    if (!scope && (req.user as any)?.role === 'superadmin') {
      return {
        total_unique_leads,
        by_branch: await this.contacts.countUniqueByBranch(),
      };
    }
    return { total_unique_leads };
  }

  // Everything known about one number: the contact, how often it was handed
  // out and worked, who last worked it, and the recent activity.
  @Get('lookup')
  async lookup(@Req() req: Request, @Query('mobile') mobile: string) {
    if (!mobile) {
      throw new BadRequestException('Please enter Mobile number');
    }
    const found = await this.contacts.findByMobile(
      scopedBranch(req),
      mobile,
    );
    return Promise.all(
      found.map(async (contact) => ({
        contact,
        summary: await this.activity.summary(String(contact._id)),
        activity: (await this.activity.history(String(contact._id), 0, 20))
          .data,
      })),
    );
  }

  @Get(':id/activity')
  async activityOf(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('page') page = '0',
    @Query('size') size = '20',
  ) {
    const contact = await this.contacts.findById(id);
    const scope = scopedBranch(req);
    if (!contact || (scope && String(contact.branch) !== scope)) {
      throw new NotFoundException('Contact not found');
    }
    return this.activity.history(
      id,
      Math.max(0, parseInt(page, 10) || 0),
      Math.min(100, Math.max(1, parseInt(size, 10) || 20)),
    );
  }
}
