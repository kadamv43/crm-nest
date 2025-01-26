import { Test, TestingModule } from '@nestjs/testing';
import { HotLeadsController } from './hot-leads.controller';

describe('HotLeadsController', () => {
  let controller: HotLeadsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HotLeadsController],
    }).compile();

    controller = module.get<HotLeadsController>(HotLeadsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
