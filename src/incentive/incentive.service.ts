import { Injectable } from '@nestjs/common';
import { Incentive } from './incentive.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { BranchesService } from 'src/branches/branches.service';
import { UserLeadsService } from 'src/user-leads/user-leads.service';
import { SpotIncentiveService } from 'src/spot-incentive/spot-incentive.service';

@Injectable()
export class IncentiveService {
  constructor(
    @InjectModel('Incentive')
    private readonly model: Model<Incentive>,
    private branchService: BranchesService,
    private userLeadService: UserLeadsService,
    private spotIncentiveService: SpotIncentiveService,
  ) {}

  async create(data): Promise<Incentive> {
    const item = new this.model(data);
    return item.save();
  }

  //spot
  //day offer
  async calculateSpotIncentive(branch, user, business) {
    const spotIncentiveBasePrice = (await this.branchService.getById(branch))
      .spot_incentive_base_business;

    console.log('si', spotIncentiveBasePrice);

    // const userCurrentMonthTotalPayment =
    //   await this.userLeadService.getCurrentMonthPaymentDoneByUserId(user?._id);
    const getTodayTotalPayment =
      await this.userLeadService.getTodayTotalPayment(user?._id);
    console.log('payment', getTodayTotalPayment);
    if (spotIncentiveBasePrice > getTodayTotalPayment) {
      return;
    }

    const spotIncenticeBracket =
      await this.spotIncentiveService.getUserIncentive(business, user?.role);

    console.log('i', spotIncenticeBracket);

    // this.model.create({});
  }
}
