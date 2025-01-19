import { Test, TestingModule } from '@nestjs/testing';
import { PaymentLinksController } from './payment-links.controller';

describe('PaymentLinksController', () => {
  let controller: PaymentLinksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentLinksController],
    }).compile();

    controller = module.get<PaymentLinksController>(PaymentLinksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
