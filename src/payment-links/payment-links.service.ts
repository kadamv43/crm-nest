import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentLink } from './payment-link.schema';
import { UpdatePaymentLinkDto } from './dto/update-payment-link.dto';

@Injectable()
export class PaymentLinksService {
  constructor(
    @InjectModel('PaymentLink') private readonly model: Model<PaymentLink>,
  ) {}

  async create(data): Promise<PaymentLink> {
    const item = new this.model(data);
    return item.save();
  }

  async findAll(params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};
    if (params.q) {
      const regex = new RegExp(params.q, 'i'); // 'i' makes it case-insensitive
      query = {
        $or: [
          { first_name: { $regex: regex } },
          { last_name: { $regex: regex } },
          { email: { $regex: regex } },
        ],
      };
    }

    if (params.branch) {
      query = {
        ...query,
        $and: [{ branch: params.branch }],
      };
    }

    const items = await this.model
      .find(query)
      .populate('branch')
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments().exec();
    return { data: items, total: totalRecords };
  }

  async getById(id: string): Promise<PaymentLink> {
    return this.model.findById(id).populate('branch').exec();
  }

  async update(
    id: string,
    updatePaymentLinkDto: UpdatePaymentLinkDto,
  ): Promise<PaymentLink> {
    const itemUpdate = await this.model
      .findByIdAndUpdate(id, updatePaymentLinkDto, {
        new: true,
      })
      .exec();
    if (!itemUpdate) {
      throw new NotFoundException(`PaymentLink with ID ${id} not found`);
    }
    return itemUpdate;
  }

  async remove(id: string): Promise<void> {
    const result = await this.model.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`PaymentLink with ID ${id} not found`);
    }
  }
}
