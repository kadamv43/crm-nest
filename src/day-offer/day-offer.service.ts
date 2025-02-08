import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateDayOfferDto } from './dto/update-day-offer.dto';
import { DayOffer } from './day-offer.schema';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class DayOfferService {
  constructor(
    @InjectModel('DayOffer')
    private readonly model: Model<DayOffer>,
  ) {}

  async create(data): Promise<DayOffer> {
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

    if (params.role) {
      query = {
        ...query,
        $and: [{ role: params.role }],
      };
    }

    const items = await this.model.find(query).skip(skip).limit(size).exec();
    const totalRecords = await this.model.countDocuments(query).exec();
    return { data: items, total: totalRecords };
  }

  async getById(id: string): Promise<DayOffer> {
    return this.model.findById(id).exec();
  }

  async update(
    id: string,
    updateMonthlyIncentiveDto: UpdateDayOfferDto,
  ): Promise<DayOffer> {
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
