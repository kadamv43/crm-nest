// blog.controller.ts
import {
  Controller,
  Post,
  Get,
  Param,
  Put,
  Delete,
  Body,
  UploadedFile,
  UseInterceptors,
  Query,
  Patch,
} from '@nestjs/common';
import { BlogService } from './blog.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { UpdateBlogDto } from './dto/update-blog.dto';

@Controller('blogs')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  async createBlog(@Body() body, @UploadedFile() file: Express.Multer.File) {
    body.image = 'blogs/' + file.filename;
    return this.blogService.createBlog(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.blogService.findAll(query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.blogService.getBlogById(id);
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('image'))
  async update(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBlogDto,
  ) {
    return this.blogService.update(id, updateDoctorDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.blogService.remove(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('image'))
  updatePartial(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBlogDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (file) {
      updateDoctorDto.image = 'blogs/' + file.filename;
    }
    return this.blogService.update(id, updateDoctorDto);
  }
}
