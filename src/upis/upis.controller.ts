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
  Req,
  UseGuards,
} from '@nestjs/common';
import { UpisService } from './upis.service';
import { UpdateUpiDto } from './dto/update-upi.dto';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';

@UseGuards(JwtAuthGuard)
@Controller('upis')
export class UpisController {
  constructor(private readonly service: UpisService) {}

  @Post()
  async createBranch(@Body() body, @Req() req: Request) {
    if (req.user['role'] == 'admin') {
      body.branch = req.user['branch']['_id'];
    }
    return this.service.create(body);
  }

  @Get()
  async findAll(@Query() query: Record<string, any>, @Req() req: Request) {
    if (req.user['role'] == 'admin') {
      query.branch = req.user['branch']['_id'];
    }
    return this.service.findAll(query);
  }

  @Get(':id')
  async getBlogById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateDto: UpdateUpiDto) {
    return this.service.update(id, updateDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Patch(':id')
  updatePartial(@Param('id') id: string, @Body() updateDto: UpdateUpiDto) {
    return this.service.update(id, updateDto);
  }
}
