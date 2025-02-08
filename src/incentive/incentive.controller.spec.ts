import { Test, TestingModule } from '@nestjs/testing';
import { IncentiveController } from './incentive.controller';

describe('IncentiveController', () => {
  let controller: IncentiveController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IncentiveController],
    }).compile();

    controller = module.get<IncentiveController>(IncentiveController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
