import { Test, TestingModule } from '@nestjs/testing';
import { DayOfferService } from './day-offer.service';

describe('DayOfferService', () => {
  let service: DayOfferService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DayOfferService],
    }).compile();

    service = module.get<DayOfferService>(DayOfferService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
