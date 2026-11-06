import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { UserLeadsService } from 'src/user-leads/user-leads.service';
import { UsersService } from 'src/users/users.service';
import { SmartViewService } from './smart-view.service';
import { daysInRange, isRealDay } from 'src/common/time.util';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private userService: UsersService,
    private userLeadsService: UserLeadsService,
    private smartViewService: SmartViewService,
  ) {}

  @Get('target-details')
  async getTarget(@Req() req: Request, @Query() query: Record<string, any>) {
    const user = await this.userService.findOne(query?.user);
    this.vet(req, user, query);
    let total = 0;
    let achieved = 0;
    let pending = 0;
    if (user.role == 'admin' || user.role == 'superadmin') {
      total = await this.userService.getTotalTargetAllEmployeeByBranch(query);
      let users = await this.userService.findByBranch(query?.branch);
      let userIds = users.map((item: any) => {
        return item?._id;
      });
      achieved = (
        await this.userLeadsService.getCurrentMonthTeamPaymentDone({
          user: userIds,
          page: query.page,
          size: query.size,
        })
      )?.totalPayment;
    } else if (user.role == 'teamlead') {
      let teamMembers = await this.userService.findByTeamlead(query?.user);
      let teamUserIds = teamMembers.map((item: any) => {
        return item?._id;
      });
      teamUserIds.push(query?.user);
      let selfTarget = user?.target;
      total = await this.userService.getTotaltargetOfTeamLead(query?.user);
      total = total + selfTarget;
      achieved = (
        await this.userLeadsService.getCurrentMonthTeamPaymentDone({
          user: teamUserIds,
          page: query.page,
          size: query.size,
        })
      )?.totalPayment;
    } else {
      total = user?.target;
      achieved = (
        await this.userLeadsService.getCurrentMonthTeamPaymentDone({
          user: [query?.user],
          page: query.page,
          size: query.size,
        })
      )?.totalPayment;
    }

    pending = total - achieved;

    // return this.userLeadsService.getFreeTrialData(query);
    return {
      total,
      achieved,
      pending,
    };
  }

  @Get('free-trial')
  async getFreeTrialByEmployeeId(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    console.log(query);
    const user = await this.userService.findOne(query?.user);
    this.vet(req, user, query);

    if (user.role == 'superadmin') {
      const users = await this.userService.findByBranch(query?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getFreeTrialData({
        user: userIds,
        page: query?.page,
        size: query?.size,
      });
    } else if (user.role == 'admin') {
      const users = await this.userService.findByBranch(user?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getFreeTrialData({
        user: userIds,
        page: query?.page,
        size: query?.size,
      });
    } else if (user.role == 'teamlead') {
      const users = await this.userService.findByTeamlead(query?.user);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      userIds.push(query?.user);
      return this.userLeadsService.getFreeTrialData({
        user: userIds,
        page: query?.page,
        size: query?.size,
      });
    } else {
      return this.userLeadsService.getFreeTrialData({
        user: [query?.user],
        page: query?.page,
        size: query?.size,
      });
    }
  }

  @Get('current-month-payments-done')
  async getCurrentMonthPaymentsDone(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    const user = await this.userService.findOne(query?.user);
    this.vet(req, user, query);
    if (user.role == 'admin' || user.role == 'superadmin') {
      let users = await this.userService.findByBranch(query?.branch);
      let userIds = users.map((item: any) => {
        return item?._id;
      });
      return await this.userLeadsService.getCurrentMonthTeamPaymentDone({
        user: userIds,
        page: query.page,
        size: query.size,
      });
    } else if (user.role == 'teamlead') {
      let teamMembers = await this.userService.findByTeamlead(query?.user);
      let teamUserIds = teamMembers.map((item: any) => {
        return item?._id;
      });
      teamUserIds.push(query?.user);

      return await this.userLeadsService.getCurrentMonthTeamPaymentDone({
        user: teamUserIds,
        page: query.page,
        size: query.size,
      });
    } else {
      return await this.userLeadsService.getCurrentMonthTeamPaymentDone({
        user: [query?.user],
        page: query.page,
        size: query.size,
      });
    }
  }

  // The smart view. Admin and superadmin can also narrow it by date (attendance
  // days, at most 31), by username, and to people who logged in; everyone else
  // always sees the current attendance day.
  @Get('smart-view')
  async getSmartView(@Req() req: Request, @Query() query: Record<string, any>) {
    const viewer: any = req.user;
    if (!query?.user || !Types.ObjectId.isValid(String(query.user))) {
      throw new BadRequestException('user is required');
    }
    const user: any = await this.userService.findOne(query.user);
    this.assertCanView(viewer, user);

    // who is in the table: decided by the role being looked at, as before
    let people: any[];
    if (user.role == 'superadmin') {
      if (!query?.branch || !Types.ObjectId.isValid(String(query.branch))) {
        throw new BadRequestException('branch is required');
      }
      people = await this.userService.findByBranch(query.branch);
    } else if (user.role == 'admin') {
      people = await this.userService.findByBranch(user.branch?._id ?? user.branch);
    } else if (user.role == 'teamlead') {
      people = await this.userService.findByTeamlead(query.user);
    } else {
      people = [{ _id: query.user }];
    }
    const userIds = people.map((p: any) => String(p?._id));

    const mayFilter = viewer.role == 'admin' || viewer.role == 'superadmin';
    let from: string | undefined;
    let to: string | undefined;
    if (mayFilter && (query.from || query.to)) {
      from = query.from || query.to;
      to = query.to || query.from;
      if (!isRealDay(from) || !isRealDay(to)) {
        throw new BadRequestException('from and to must look like 2025-01-31');
      }
      if (from > to) {
        throw new BadRequestException('from must not be after to');
      }
      if (daysInRange(from, to) > 31) {
        throw new BadRequestException('Please choose at most 31 days');
      }
    }

    return this.smartViewService.build({
      userIds,
      from,
      to,
      q: mayFilter ? String(query.q ?? '') : undefined,
      loggedInOnly: mayFilter && query.logged_in === 'true',
      page: parseInt(query.page, 10) || 0,
      size: Math.min(500, parseInt(query.size, 10) || 50),
    });
  }

  // You may look at your own company, and within it only at yourself (staff),
  // your own team (team lead) or anyone but the superadmin (admin).
  private assertCanView(viewer: any, target: any) {
    if (viewer.role === 'superadmin') {
      return;
    }
    const viewerBranch = String(viewer.branch?._id ?? viewer.branch ?? '');
    const targetBranch = String(target.branch?._id ?? target.branch ?? '');
    const sameCompany = viewerBranch !== '' && viewerBranch === targetBranch;
    const self = String(target._id) === String(viewer.userId);

    const allowed =
      sameCompany &&
      target.role !== 'superadmin' &&
      (viewer.role === 'admin' ||
        self ||
        (viewer.role === 'teamlead' &&
          String(target.teamlead ?? '') === String(viewer.userId)));
    if (!allowed) {
      throw new ForbiddenException('You cannot view this user');
    }
  }

  // The address says whose numbers to show and which company; neither may be taken
  // on trust. The person must be someone the caller may look at, and anyone but the
  // superadmin is kept inside their own company.
  private vet(req: any, target: any, query: Record<string, any>) {
    const viewer = req?.user;
    if (!viewer) throw new ForbiddenException('Not allowed');
    this.assertCanView(viewer, target);
    if (viewer.role !== 'superadmin') {
      query.branch = String(viewer.branch?._id ?? viewer.branch ?? '');
    }
  }

  // For the "today" figures, where naming nobody used to mean everybody.
  private async vetOptionalUser(req: any, query: Record<string, any>) {
    const viewer = req?.user;
    if (!viewer) throw new ForbiddenException('Not allowed');
    if (!query.user && (viewer.role === 'employee' || viewer.role === 'teamlead')) {
      query.user = String(viewer.userId);
    }
    if (query.user) {
      if (!Types.ObjectId.isValid(String(query.user))) {
        throw new BadRequestException('Invalid user');
      }
      const target = await this.userService.findOne(query.user);
      this.vet(req, target, query);
    } else if (viewer.role !== 'superadmin') {
      query.branch = String(viewer.branch?._id ?? viewer.branch ?? '');
    }
  }

  @Get('reports')
  async getReports(@Req() req: Request, @Query() query: Record<string, any>) {
    const user = await this.userService.findOne(query?.user);
    this.vet(req, user, query);
    const campaignReport = query.campaign_report === 'true';

    if (campaignReport) {
      if (user.role === 'employee') {
        throw new ForbiddenException('Campaign reports are not available to employees');
      }
      if (user.role === 'superadmin') {
        if (!query.branch || !Types.ObjectId.isValid(String(query.branch))) {
          throw new BadRequestException('branch is required');
        }
      } else {
        const userBranch: any = user.branch;
        query.branch = String(userBranch?._id ?? userBranch ?? '');
      }
    }

    if (campaignReport && (user.role == 'superadmin' || user.role == 'admin')) {
      // The company is already fixed by the campaigns; do not also limit it to staff
      // who still exist, or the lines of someone who has left would vanish.
      delete query.user;
      return this.userLeadsService.getReports(query);
    }

    if (user.role == 'superadmin') {
      const users = await this.userService.findByBranch(query?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      query['user'] = userIds;
      return this.userLeadsService.getReports(query);
    } else if (user.role == 'admin') {
      const users = await this.userService.findByBranch(user?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      query['user'] = userIds;
      return this.userLeadsService.getReports(query);
    } else if (user.role == 'teamlead') {
      const users = await this.userService.findByTeamlead(query?.user);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      // A team lead's report includes their own leads, like the other dashboard views.
      userIds.push(query?.user);
      query['user'] = userIds;
      return this.userLeadsService.getReports(query);
    } else {
      return this.userLeadsService.getReports(query);
    }
  }

  @Get('todays-payments-done')
  async getTodaysPaymentsDone(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    await this.vetOptionalUser(req, query);
    return this.userLeadsService.getTodaysPaymentsDoneData(query);
  }

  @Get('todays-expected-payment')
  async getTodaysExpectedPayment(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    await this.vetOptionalUser(req, query);
    return this.userLeadsService.getTodaysExpectedPayment(query);
  }
}
