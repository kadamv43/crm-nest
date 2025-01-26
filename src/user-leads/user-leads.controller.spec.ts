import { Test, TestingModule } from '@nestjs/testing';
import { UserLeadsController } from './user-leads.controller';

describe('UserLeadsController', () => {
  let controller: UserLeadsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserLeadsController],
    }).compile();

    controller = module.get<UserLeadsController>(UserLeadsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
