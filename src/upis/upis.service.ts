import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Upi } from './upi.schema';
import { UpdateUpiDto } from './dto/update-upi.dto';

@Injectable()
export class UpisService {
  constructor(@InjectModel('Upi') private readonly model: Model<Upi>) {}

  async create(data): Promise<Upi> {
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

  async getById(id: string): Promise<Upi> {
    return this.model.findById(id).populate('branch').exec();
  }

  async update(id: string, updateUpiDto: UpdateUpiDto): Promise<Upi> {
    const itemUpdate = await this.model
      .findByIdAndUpdate(id, updateUpiDto, {
        new: true,
      })
      .exec();
    if (!itemUpdate) {
      throw new NotFoundException(`Upi with ID ${id} not found`);
    }
    return itemUpdate;
  }

  async remove(id: string): Promise<void> {
    const result = await this.model.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Upi with ID ${id} not found`);
    }
  }
}
