import { Module } from '@nestjs/common';
import { SpotIncentiveService } from './spot-incentive.service';
import { SpotIncentiveController } from './spot-incentive.controller';
import { SpotIncentive, SpotIncentiveSchema } from './spot-incentive.schema';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SpotIncentive.name, schema: SpotIncentiveSchema },
    ]),
  ],
  exports: [SpotIncentiveService, MongooseModule],
  providers: [SpotIncentiveService],
  controllers: [SpotIncentiveController],
})
export class SpotIncentiveModule {}
