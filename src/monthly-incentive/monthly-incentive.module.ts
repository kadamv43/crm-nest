import { Module } from '@nestjs/common';
import { MonthlyIncentiveController } from './monthly-incentive.controller';
import { MonthlyIncentiveService } from './monthly-incentive.service';
import {
  MonthlyIncentiveSchema,
  MonthlyIncentive,
} from './monthly-incentive.schema';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MonthlyIncentive.name, schema: MonthlyIncentiveSchema },
    ]),
  ],
  controllers: [MonthlyIncentiveController],
  providers: [MonthlyIncentiveService],
})
export class MonthlyIncentiveModule {}
