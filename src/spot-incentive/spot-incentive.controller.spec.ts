import { Test, TestingModule } from '@nestjs/testing';
import { SpotIncentiveController } from './spot-incentive.controller';

describe('SpotIncentiveController', () => {
  let controller: SpotIncentiveController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SpotIncentiveController],
    }).compile();

    controller = module.get<SpotIncentiveController>(SpotIncentiveController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
