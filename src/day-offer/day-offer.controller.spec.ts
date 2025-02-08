import { Test, TestingModule } from '@nestjs/testing';
import { DayOfferController } from './day-offer.controller';

describe('DayOfferController', () => {
  let controller: DayOfferController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DayOfferController],
    }).compile();

    controller = module.get<DayOfferController>(DayOfferController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
