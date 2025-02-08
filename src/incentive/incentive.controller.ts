import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IncentiveService } from './incentive.service';

@Controller('incentive')
export class IncentiveController {
  constructor(private incentiveService: IncentiveService) {}

  @Post()
  async findAll(@Body() body) {
    const { user, business } = body;
    console.log(body);
    return this.incentiveService.calculateSpotIncentive(
      user?.branch,
      user,
      business,
    );
  }
}
