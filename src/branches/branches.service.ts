import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Branch } from './branch.schema';
import { UpdateBlogDto } from 'src/blog/dto/update-blog.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    @InjectModel('Branch') private readonly branchModel: Model<Branch>,
  ) {}

  async create(data): Promise<Branch> {
    const newBlog = new this.branchModel(data);
    return newBlog.save();
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
    const blogs = await this.branchModel
      .find(query)
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.branchModel.countDocuments().exec();
    return { data: blogs, total: totalRecords };
  }

  async getById(blogId: string): Promise<Branch> {
    return this.branchModel.findById(blogId).exec();
  }

  async update(id: string, updateDto: UpdateBranchDto): Promise<Branch> {
    const updatedBlog = await this.branchModel
      .findByIdAndUpdate(id, updateDto, {
        new: true,
      })
      .exec();
    if (!updatedBlog) {
      throw new NotFoundException(`Branch with ID ${id} not found`);
    }
    return updatedBlog;
  }

  async remove(id: string): Promise<void> {
    const result = await this.branchModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Branch with ID ${id} not found`);
    }
  }
}
