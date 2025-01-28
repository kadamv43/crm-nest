// src/patients/patients.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead } from './lead.schema';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

@Injectable()
export class LeadsService {
  prefix = 'PATIENT-';
  constructor(@InjectModel(Lead.name) private readonly model: Model<Lead>) {}

  async create(createDto: CreateLeadDto[]) {
    // const { mobile } = createDto;
    // const existingPatient = await this.model.findOne({ mobile }).exec();

    // if (existingPatient) {
    //   return existingPatient;
    // }
    return await this.model.insertMany(createDto);
    // const createdPatient = new this.model(createDto);
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
      .sort({ patient_number: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments().exec();
    return { data: patients, total: totalRecords };
  }

  async getById(id: string): Promise<Lead> {
    const patient = await this.model.findById(id).exec();
    if (!patient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return patient;
  }

  async findBy(query: Record<string, any>): Promise<Lead[]> {
    return this.model.find(query).exec();
  }

  async findByOne(query: Record<string, any>): Promise<Lead> {
    return this.model.findOne(query).exec();
  }

  async update(id: string, updatePatientDto: UpdateLeadDto): Promise<Lead> {
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

  async remove(id: string): Promise<Lead> {
    const deletedPatient = await this.model.findByIdAndDelete(id).exec();
    if (!deletedPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return deletedPatient;
  }

  async globalSearch(query: string): Promise<Lead[]> {
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
      });
      await item.save();
    }
  }
}
