import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Banner } from './banner.schema';
import { UpdateGalleryDto } from 'src/gallery/dto/update-gallery.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Injectable()
export class BannersService {
  constructor(
    @InjectModel('Banner') private readonly blogModel: Model<Banner>,
  ) {}

  async createBlog(data): Promise<Banner> {
    const newBlog = new this.blogModel(data);
    return newBlog.save();
  }

  async findAll(params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};

    if (params.status) {
      query = { status: params.status };
    }
    const blogs = await this.blogModel
      .find(query)
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.blogModel.countDocuments().exec();
    return { data: blogs, total: totalRecords };
  }

  async getBlogById(blogId: string): Promise<Banner> {
    return this.blogModel.findById(blogId).exec();
  }

  async update(id: string, updateBlogDto: UpdateBannerDto): Promise<Banner> {
    const updatedBlog = await this.blogModel
      .findByIdAndUpdate(id, updateBlogDto, {
        new: true,
      })
      .exec();
    if (!updatedBlog) {
      throw new NotFoundException(`Blog with ID ${id} not found`);
    }
    return updatedBlog;
  }

  async remove(id: string): Promise<void> {
    const result = await this.blogModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Blog with ID ${id} not found`);
    }
  }
}
