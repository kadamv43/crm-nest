// src/patients/patients.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserLead } from './user-lead.schema';
import { CreateUserLeadDto } from './dto/create-user-lead.dto';
import { UpdateUserLeadDto } from './dto/update-user-lead.dto';

@Injectable()
export class UserLeadsService {
  constructor(
    @InjectModel(UserLead.name) private readonly model: Model<UserLead>,
  ) {}

  async create(createDto: CreateUserLeadDto[]) {
    // const { mobile } = createDto;
    // const existingPatient = await this.model.findOne({ mobile }).exec();

    // if (existingPatient) {
    //   return existingPatient;
    // }
    return await this.model.insertMany(createDto);
    // return createdPatient.save();
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

  async getById(id: string): Promise<UserLead> {
    const patient = await this.model.findById(id).exec();
    if (!patient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return patient;
  }

  async getByUserId(id: string, params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};

    query = { user: id };
    if (params.status) {
      query = {
        $and: [{ status: params.status }],
      };
    }

    const patients = await this.model
      .find(query)
      .sort({ patient_number: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments(query).exec();
    return { data: patients, total: totalRecords };
  }

  async findBy(query: Record<string, any>): Promise<UserLead[]> {
    return this.model.find(query).exec();
  }

  async findByOne(query: Record<string, any>): Promise<UserLead> {
    return this.model.findOne(query).exec();
  }

  async update(
    id: string,
    updatePatientDto: UpdateUserLeadDto,
  ): Promise<UserLead> {
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

  async remove(id: string): Promise<UserLead> {
    const deletedPatient = await this.model.findByIdAndDelete(id).exec();
    if (!deletedPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return deletedPatient;
  }

  async globalSearch(query: string): Promise<UserLead[]> {
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
