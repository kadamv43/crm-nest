import { Test, TestingModule } from '@nestjs/testing';
import { UserHotLeadsController } from './user-hot-leads.controller';

describe('UserHotLeadsController', () => {
  let controller: UserHotLeadsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserHotLeadsController],
    }).compile();

    controller = module.get<UserHotLeadsController>(UserHotLeadsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
