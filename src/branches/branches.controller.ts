import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
import { Request } from 'express';

@UseGuards(JwtAuthGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly service: BranchesService) {}

  @Post()
  async createBranch(@Body() body) {
    return this.service.create(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.service.findAll(query);
  }

  @Patch('update-spot-incentive-base')
  updateBase(@Body() updateDto: UpdateBranchDto, @Req() req: Request) {
    if (req?.user['role'] == 'admin') {
      return this.service.update(req?.user['branch']['_id'], updateDto);
    } else {
      throw new ForbiddenException('No access');
    }
  }

  @Get('my-branch')
  async getMyBranch(@Req() req: Request) {
    const branch = req?.user['branch']['_id'];
    return this.service.getById(branch);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateDto: UpdateBranchDto) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id')
  updatePartial(@Param('id') id: string, @Body() updateDto: UpdateBranchDto) {
    return this.service.update(id, updateDto);
  }
}
