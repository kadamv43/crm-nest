import { Test, TestingModule } from '@nestjs/testing';
import { UserLeadsService } from './user-leads.service';

describe('UserLeadsService', () => {
  let service: UserLeadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserLeadsService],
    }).compile();

    service = module.get<UserLeadsService>(UserLeadsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
