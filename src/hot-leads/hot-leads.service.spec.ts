import { Test, TestingModule } from '@nestjs/testing';
import { HotLeadsService } from './hot-leads.service';

describe('HotLeadsService', () => {
  let service: HotLeadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HotLeadsService],
    }).compile();

    service = module.get<HotLeadsService>(HotLeadsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
