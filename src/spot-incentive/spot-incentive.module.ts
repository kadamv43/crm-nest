import { Module } from '@nestjs/common';
import { SpotIncentiveService } from './spot-incentive.service';
import { SpotIncentiveController } from './spot-incentive.controller';
import { SpotIncentive, SpotIncentiveSchema } from './spot-incentiveschema';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SpotIncentive.name, schema: SpotIncentiveSchema },
    ]),
  ],
  providers: [SpotIncentiveService],
  controllers: [SpotIncentiveController],
})
export class SpotIncentiveModule {}
