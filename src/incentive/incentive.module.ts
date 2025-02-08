import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Incentive, IncentiveSchema } from './incentive.schema';
import { IncentiveService } from './incentive.service';
import { BranchesService } from 'src/branches/branches.service';
import { UserLeadsService } from 'src/user-leads/user-leads.service';
import { SpotIncentiveService } from 'src/spot-incentive/spot-incentive.service';
import { BranchesModule } from 'src/branches/branches.module';
import { UserLeadsModule } from 'src/user-leads/user-leads.module';
import { SpotIncentiveModule } from 'src/spot-incentive/spot-incentive.module';
import { IncentiveController } from './incentive.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Incentive.name, schema: IncentiveSchema },
    ]),
    BranchesModule,
    UserLeadsModule,
    SpotIncentiveModule,
  ],
  providers: [
    BranchesService,
    UserLeadsService,
    SpotIncentiveService,
    IncentiveService,
  ],
  controllers: [IncentiveController],
})
export class IncentiveModule {}
