// src/patients/patients.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Patient } from './patients.schema';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
@Injectable()
export class PatientsService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
  ) {}

  async create(createPatientDto: CreatePatientDto): Promise<Patient> {
    const createdPatient = new this.patientModel(createPatientDto);
    return createdPatient.save();
  }

  async findAll(): Promise<Patient[]> {
    return this.patientModel.find().exec();
  }

  async findOne(id: string): Promise<Patient> {
    const patient = await this.patientModel.findById(id).exec();
    if (!patient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return patient;
  }

  async findBy(query: Record<string, any>): Promise<Patient[]> {
    return this.patientModel.find(query).exec();
  }

  async update(
    id: string,
    updatePatientDto: UpdatePatientDto,
  ): Promise<Patient> {
    const existingPatient = await this.patientModel
      .findByIdAndUpdate(id, updatePatientDto, { new: true })
      .exec();
    if (!existingPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return existingPatient;
  }

  async remove(id: string): Promise<Patient> {
    const deletedPatient = await this.patientModel.findByIdAndDelete(id).exec();
    if (!deletedPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return deletedPatient;
  }

  async globalSearch(query: string): Promise<Patient[]> {
    const searchRegex = new RegExp(query, 'i'); // 'i' makes it case insensitive
    return this.patientModel
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
}
