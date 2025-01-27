import { Test, TestingModule } from '@nestjs/testing';
import { MonthlyIncentiveController } from './monthly-incentive.controller';

describe('MonthlyIncentiveController', () => {
  let controller: MonthlyIncentiveController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MonthlyIncentiveController],
    }).compile();

    controller = module.get<MonthlyIncentiveController>(MonthlyIncentiveController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
