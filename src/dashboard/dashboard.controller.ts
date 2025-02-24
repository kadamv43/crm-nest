import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { UserLeadsService } from 'src/user-leads/user-leads.service';
import { UsersService } from 'src/users/users.service';

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private userService: UsersService,
    private userLeadsService: UserLeadsService,
  ) {}

  @Get('target-details')
  async getTarget(@Req() req: Request, @Query() query: Record<string, any>) {
    const user = await this.userService.findOne(query?.user);
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
        })
      )?.totalPayment;
    } else {
      total = user?.target;
      achieved = (
        await this.userLeadsService.getCurrentMonthTeamPaymentDone({
          user: [query?.user],
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
    const user = await this.userService.findOne(query?.user);

    if (user.role == 'superadmin') {
      const users = await this.userService.findByBranch(query?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getFreeTrialData({ user: userIds });
    } else if (user.role == 'admin') {
      const users = await this.userService.findByBranch(user?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getFreeTrialData({ user: userIds });
    } else if (user.role == 'teamlead') {
      const users = await this.userService.findByTeamlead(query?.user);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getFreeTrialData({ user: userIds });
    } else {
      return this.userLeadsService.getFreeTrialData({ user: [query?.user] });
    }
  }

  @Get('current-month-payments-done')
  async getCurrentMonthPaymentsDone(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    const user = await this.userService.findOne(query?.user);
    if (user.role == 'admin' || user.role == 'superadmin') {
      let users = await this.userService.findByBranch(query?.branch);
      let userIds = users.map((item: any) => {
        return item?._id;
      });
      return await this.userLeadsService.getCurrentMonthTeamPaymentDone({
        user: userIds,
      });
    } else if (user.role == 'teamlead') {
      let teamMembers = await this.userService.findByTeamlead(query?.user);
      let teamUserIds = teamMembers.map((item: any) => {
        return item?._id;
      });
      teamUserIds.push(query?.user);

      return await this.userLeadsService.getCurrentMonthTeamPaymentDone({
        user: teamUserIds,
      });
    } else {
      return await this.userLeadsService.getCurrentMonthTeamPaymentDone({
        user: [query?.user],
      });
    }
  }

  @Get('smart-view')
  async getSmartView(@Req() req: Request, @Query() query: Record<string, any>) {
    const user = await this.userService.findOne(query?.user);

    if (user.role == 'superadmin') {
      const users = await this.userService.findByBranch(query?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getStatusCountByUser({ user: userIds });
    } else if (user.role == 'admin') {
      const users = await this.userService.findByBranch(user?.branch);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getStatusCountByUser({ user: userIds });
    } else if (user.role == 'teamlead') {
      const users = await this.userService.findByTeamlead(query?.user);
      const userIds = users.map((user: any) => {
        return user?._id;
      });
      return this.userLeadsService.getStatusCountByUser({ user: userIds });
    } else {
      return this.userLeadsService.getStatusCountByUser({ user: query?.user });
    }
  }

  @Get('reports')
  async getReports(@Req() req: Request, @Query() query: Record<string, any>) {
    const user = await this.userService.findOne(query?.user);

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
    return this.userLeadsService.getTodaysPaymentsDoneData(query);
  }

  @Get('todays-expected-payment')
  async getTodaysExpectedPayment(
    @Req() req: Request,
    @Query() query: Record<string, any>,
  ) {
    return this.userLeadsService.getTodaysExpectedPayment(query);
  }
}
