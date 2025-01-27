import { Test, TestingModule } from '@nestjs/testing';
import { MonthlyIncentiveService } from './monthly-incentive.service';

describe('MonthlyIncentiveService', () => {
  let service: MonthlyIncentiveService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MonthlyIncentiveService],
    }).compile();

    service = module.get<MonthlyIncentiveService>(MonthlyIncentiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
