import { Test, TestingModule } from '@nestjs/testing';
import { SpotIncentiveService } from './spot-incentive.service';

describe('SpotIncentiveService', () => {
  let service: SpotIncentiveService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SpotIncentiveService],
    }).compile();

    service = module.get<SpotIncentiveService>(SpotIncentiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
