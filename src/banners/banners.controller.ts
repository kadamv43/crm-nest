import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { BannersService } from './banners.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Controller('banners')
export class BannersController {
  constructor(private readonly bannerService: BannersService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  async createBlog(@Body() body, @UploadedFile() file: Express.Multer.File) {
    body.image = 'banners/' + file.filename;
    return this.bannerService.createBlog(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.bannerService.findAll(query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.bannerService.getBlogById(id);
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('image'))
  async update(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBannerDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (file) {
      updateDoctorDto.image = 'banners/' + file.filename;
    }

    return this.bannerService.update(id, updateDoctorDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.bannerService.remove(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('image'))
  updatePartial(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBannerDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (file) {
      updateDoctorDto.image = 'banners/' + file.filename;
    }
    return this.bannerService.update(id, updateDoctorDto);
  }
}
