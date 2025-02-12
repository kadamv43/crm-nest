import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SpotIncentive } from './spot-incentive.schema';
import { UpdateSpotIncentiveDto } from './dto/update-spot-incentive.dto';

@Injectable()
export class SpotIncentiveService {
  constructor(
    @InjectModel('SpotIncentive') private readonly model: Model<SpotIncentive>,
  ) {}

  async create(data): Promise<SpotIncentive> {
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

  async getById(id: string): Promise<SpotIncentive> {
    return this.model.findById(id).exec();
  }

  async update(
    id: string,
    updateSpotIncentiveDto: UpdateSpotIncentiveDto,
  ): Promise<SpotIncentive> {
    const itemUpdate = await this.model
      .findByIdAndUpdate(id, updateSpotIncentiveDto, {
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

  async getUserIncentive(business: number, role: string) {
    const result = await this.model
      .find({
        role: role,
      })
      .sort({ business: 1 }); // Sort by business in ascending order

    // Find the closest lower bound business bracket
    let closestBracket = null;
    for (const entry of result) {
      const bracketBusiness = parseInt(entry.business);
      if (bracketBusiness <= business) {
        closestBracket = entry;
      } else {
        break; // Stop once we pass the business range
      }
    }

    return closestBracket ? closestBracket.incentive : 0; // Return incentive or 0 if no match
  }
}
