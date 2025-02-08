import { Module } from '@nestjs/common';
import { DayOfferService } from './day-offer.service';
import { DayOfferController } from './day-offer.controller';
import { DayOffer, DayOfferSchema } from './day-offer.schema';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  providers: [DayOfferService],
  imports: [
    MongooseModule.forFeature([
      { name: DayOffer.name, schema: DayOfferSchema },
    ]),
  ],
  controllers: [DayOfferController],
})
export class DayOfferModule {}
