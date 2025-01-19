import { Module } from '@nestjs/common';
import { UpisService } from './upis.service';
import { UpisController } from './upis.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Upi, UpiSchema } from './upi.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Upi.name, schema: UpiSchema }])],
  providers: [UpisService],
  controllers: [UpisController],
})
export class UpisModule {}
