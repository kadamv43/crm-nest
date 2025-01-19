import { Test, TestingModule } from '@nestjs/testing';
import { UpisService } from './upis.service';

describe('UpisService', () => {
  let service: UpisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UpisService],
    }).compile();

    service = module.get<UpisService>(UpisService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
