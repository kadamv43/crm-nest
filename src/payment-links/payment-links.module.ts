import { Module } from '@nestjs/common';
import { PaymentLinksService } from './payment-links.service';
import { PaymentLink, PaymentLinkSchema } from './payment-link.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentLinksController } from './payment-links.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentLink.name, schema: PaymentLinkSchema },
    ]),
  ],
  providers: [PaymentLinksService],
  controllers: [PaymentLinksController],
})
export class PaymentLinksModule {}
