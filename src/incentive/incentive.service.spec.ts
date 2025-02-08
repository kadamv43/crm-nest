import { Test, TestingModule } from '@nestjs/testing';
import { IncentiveService } from './incentive.service';

describe('IncentiveService', () => {
  let service: IncentiveService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IncentiveService],
    }).compile();

    service = module.get<IncentiveService>(IncentiveService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
