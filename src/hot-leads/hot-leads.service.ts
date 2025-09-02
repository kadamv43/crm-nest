// src/patients/patients.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HotLead } from './hot-lead.schema';
import { UpdateHotLeadDto } from './dto/update-hot-lead.dto';
import { CreateHotLeadDto } from './dto/create-hot-lead.dto';

@Injectable()
export class HotLeadsService {
  prefix = 'PATIENT-';
  constructor(
    @InjectModel(HotLead.name) private readonly model: Model<HotLead>,
  ) {}

  async create(createDto: CreateHotLeadDto): Promise<HotLead> {
    const { mobile } = createDto;
    const existingPatient = await this.model.findOne({ mobile }).exec();

    if (existingPatient) {
      return existingPatient;
    }
    const createdPatient = new this.model(createDto);
    return createdPatient.save();
  }

  async deleteByIds(ids: string[]): Promise<any> {
    const objectIds = ids.map((id) => new Types.ObjectId(id)); // Convert to ObjectId
    return await this.model.deleteMany({ _id: { $in: objectIds } });
  }

  async findAll(params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};
    if (params.q) {
      const regex = new RegExp(params.q, 'i'); // 'i' makes it case-insensitive

      query = {
        $or: [
          { patient_number: !isNaN(params.q) ? Number(params.q) : 0 },
          { first_name: { $regex: regex } },
          { last_name: { $regex: regex } },
          { email: { $regex: regex } },
          { mobile: { $regex: regex } },
        ],
      };
    }

    const patients = await this.model
      .find(query)
      .sort({ created_at: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments().exec();
    return { data: patients, total: totalRecords };
  }

  async getById(id: string): Promise<HotLead> {
    const patient = await this.model.findById(id).exec();
    if (!patient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return patient;
  }

  async findBy(query: Record<string, any>): Promise<HotLead[]> {
    return this.model.find(query).exec();
  }

  async findByOne(query: Record<string, any>): Promise<HotLead> {
    return this.model.findOne(query).exec();
  }

  async update(
    id: string,
    updatePatientDto: UpdateHotLeadDto,
  ): Promise<HotLead> {
    const existingPatient = await this.model
      .findByIdAndUpdate(id, updatePatientDto, { new: true })
      .exec();
    if (!existingPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return existingPatient;
  }

  async insertData(data: any[]): Promise<any> {
    try {
      const insertedData = await this.model.insertMany(data);
      return { message: 'Data inserted successfully', insertedData };
    } catch (error) {
      throw new Error(`Failed to insert data: ${error.message}`);
    }
  }

  async remove(id: string): Promise<HotLead> {
    const deletedPatient = await this.model.findByIdAndDelete(id).exec();
    if (!deletedPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return deletedPatient;
  }

  async globalSearch(query: string): Promise<HotLead[]> {
    const searchRegex = new RegExp(query, 'i'); // 'i' makes it case insensitive
    return this.model
      .find({
        $or: [
          { first_name: searchRegex },
          { last_name: searchRegex },
          { email: searchRegex },
          { mobile: searchRegex },
        ],
      })
      .exec();
  }

  async importData(jsonData) {
    console.log(jsonData);
    for (const data of jsonData) {
      const item = new this.model({
        mobile: data['mobile'],
        name: data['name'],
        city: data['city'],
        investment: data['investment'],
      });
      await item.save();
    }
  }
}
