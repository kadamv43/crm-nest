// src/patients/patients.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Patient } from './patients.schema';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
@Injectable()
export class PatientsService {
  prefix = 'PATIENT-';
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
  ) {}

  async create(createPatientDto: CreatePatientDto): Promise<Patient> {
    const { mobile } = createPatientDto;
    const existingPatient = await this.patientModel.findOne({ mobile }).exec();

    console.log('ex', existingPatient);

    if (existingPatient) {
      return existingPatient;
    }
    createPatientDto.patient_number = await this.generateUniquePatientNumber();
    const createdPatient = new this.patientModel(createPatientDto);
    return createdPatient.save();
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

    const patients = await this.patientModel
      .find(query)
      .sort({ patient_number: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.patientModel.countDocuments().exec();
    return { data: patients, total: totalRecords };
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

  async findByOne(query: Record<string, any>): Promise<Patient> {
    return this.patientModel.findOne(query).exec();
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

  async insertData(data: any[]): Promise<any> {
    try {
      const insertedData = await this.patientModel.insertMany(data);
      return { message: 'Data inserted successfully', insertedData };
    } catch (error) {
      throw new Error(`Failed to insert data: ${error.message}`);
    }
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

  async generateUniquePatientNumber(): Promise<string> {
    const lastPatient = await this.patientModel
      .findOne()
      .sort({ patient_number: -1 })
      .exec();

    console.log(lastPatient);
    let lastNumber = 0;

    if (lastPatient && lastPatient?.patient_number) {
      lastNumber = lastPatient.patient_number;
      // lastNumber = parseInt(lastNumberString);
    }

    const nextNumber = lastNumber + 1;
    // const paddedNumber = nextNumber.toString().padStart(7, '0'); // Adjust length as needed
    return `${nextNumber}`;
  }

  async importData(jsonData) {
    for (const data of jsonData) {
      let patienNumber = await this.generateUniquePatientNumber();
      const item = new this.patientModel({
        patient_number: patienNumber,
        first_name: data['first_name'],
        last_name: data['last_name'],
        mobile: data['mobile'],
        age: data['age'],
        reference_by: data['reference_by'],
      });
      await item.save();
    }
  }
}
