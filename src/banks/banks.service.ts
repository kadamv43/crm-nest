import { Injectable, NotFoundException } from '@nestjs/common';
import { Bank } from './bank.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { UpdateBankDto } from './dto/update-bank.dto';

@Injectable()
export class BanksService {
  constructor(@InjectModel('Bank') private readonly model: Model<Bank>) {}

  async create(data): Promise<Bank> {
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

  async getById(id: string): Promise<Bank> {
    return this.model.findById(id).populate('branch').exec();
  }

  async update(id: string, updateBankDto: UpdateBankDto): Promise<Bank> {
    const itemUpdate = await this.model
      .findByIdAndUpdate(id, updateBankDto, {
        new: true,
      })
      .exec();
    if (!itemUpdate) {
      throw new NotFoundException(`Bank with ID ${id} not found`);
    }
    return itemUpdate;
  }

  async remove(id: string): Promise<void> {
    const result = await this.model.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Bank with ID ${id} not found`);
    }
  }
}
