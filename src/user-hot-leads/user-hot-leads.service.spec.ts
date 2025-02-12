import { Test, TestingModule } from '@nestjs/testing';
import { UserHotLeadsService } from './user-hot-leads.service';

describe('UserHotLeadsService', () => {
  let service: UserHotLeadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserHotLeadsService],
    }).compile();

    service = module.get<UserHotLeadsService>(UserHotLeadsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
