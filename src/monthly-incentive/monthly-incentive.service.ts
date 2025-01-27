import { Injectable, NotFoundException } from '@nestjs/common';
import { MonthlyIncentive } from './monthly-incentiveschema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { UpdateMonthlyIncentiveDto } from './dto/update-monthly-incentive.dto';

@Injectable()
export class MonthlyIncentiveService {
  constructor(
    @InjectModel('MonthlyIncentive')
    private readonly model: Model<MonthlyIncentive>,
  ) {}

  async create(data): Promise<MonthlyIncentive> {
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
    const items = await this.model.find(query).skip(skip).limit(size).exec();
    const totalRecords = await this.model.countDocuments().exec();
    return { data: items, total: totalRecords };
  }

  async getById(id: string): Promise<MonthlyIncentive> {
    return this.model.findById(id).exec();
  }

  async update(
    id: string,
    updateMonthlyIncentiveDto: UpdateMonthlyIncentiveDto,
  ): Promise<MonthlyIncentive> {
    const itemUpdate = await this.model
      .findByIdAndUpdate(id, updateMonthlyIncentiveDto, {
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
