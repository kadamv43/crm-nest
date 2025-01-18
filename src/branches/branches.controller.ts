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
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { UpdateBlogDto } from 'src/blog/dto/update-blog.dto';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  async createBranch(@Body() body) {
    return this.branchesService.createBranch(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.branchesService.findAll(query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.branchesService.getBranchById(id);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBlogDto,
  ) {
    return this.branchesService.update(id, updateDoctorDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.branchesService.remove(id);
  }

  @Patch(':id')
  updatePartial(
    @Param('id') id: string,
    @Body() updateDoctorDto: UpdateBlogDto,
  ) {
    return this.branchesService.update(id, updateDoctorDto);
  }
}
