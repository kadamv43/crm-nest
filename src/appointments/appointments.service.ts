import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Appointment, AppointmentDocument } from './appointment.schema';
import { CreateAppointmentWebDto } from './dto/create-appointment-web.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { PatientsService } from 'src/patients/patients.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Injectable()
export class AppointmentsService {
  private readonly prefix = 'GENOMICS-';

  constructor(
    @InjectModel(Appointment.name)
    private appointmentModel: Model<AppointmentDocument>,
    private patientService: PatientsService,
  ) {}

  async create(
    createAppointmentDto: CreateAppointmentDto,
  ): Promise<Appointment> {
    const createdAppointment = new this.appointmentModel(createAppointmentDto);
    return createdAppointment.save();
  }

  async createFromWeb(
    createAppointmentDto: CreateAppointmentWebDto,
  ): Promise<Appointment> {
    const createdAppointment = new this.appointmentModel(createAppointmentDto);
    return createdAppointment.save();
  }

  async findAll(params) {
    console.log(params);
    const { page, size, q, from, to, status } = params;
    const skip = page * size;

    let query = {};

    if (from && !to) {
      const startDate = new Date(from).toISOString();
      query['appointment_date'] = {
        $gte: startDate,
        $lt: this.getEndDate(startDate),
      };
    }

    if (from && to) {
      const startDate = new Date(from).toISOString();
      const endDate = this.getEndDate(new Date(to).toISOString());
      query['appointment_date'] = {
        $gte: startDate,
        $lt: endDate,
      };
    }

    if (status) {
      query['status'] = status;
    }

    if (q) {
      const patientData = await this.patientService.globalSearch(q);
      const patient_ids = patientData.map((item: any) => item?._id);
      console.log('patient', patientData);
      query['patient'] = { $in: patient_ids };
    }

    console.log('q', query);

    const queryM = this.appointmentModel
      .find(query)
      .populate('patient')
      .populate('doctor')
      .sort({ created_at: 'desc' })
      .skip(skip)
      .limit(size);
    // .exec();

    const appointments = await queryM.exec();
    console.log(appointments.length);

    const totalRecords = await this.appointmentModel
      .countDocuments(query)
      .exec();
    return { data: appointments, total: totalRecords };
  }

  async findOne(id: string): Promise<any> {
    const appointment = await this.appointmentModel
      .findById(id)
      .populate('patient')
      .populate('doctor')
      .populate('services')
      .populate('invoice')
      .exec();

    if (!appointment) {
      throw new NotFoundException(`Appointment with ID ${id} not found`);
    }

    return {
      ...appointment.toObject(),
    };
  }

  async findByPatienId(id: string) {
    const patient = await this.patientService.findOne(id);
    // console.log('mob',mobile)
    const appointments = await this.appointmentModel
      .find({ patient: id })
      .populate('patient')
      .populate('doctor')
      .populate('invoice')
      .populate('services')
      .sort({ created_at: 'desc' })
      .limit(5)
      .exec();

    return {
      patient,
      appointments,
    };
  }

  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
  ): Promise<Appointment> {
    return this.appointmentModel
      .findByIdAndUpdate(id, updateAppointmentDto, { new: true })
      .exec();
  }

  async addFilesToAppointment(
    id: string,
    file: string,
    file_name: string,
  ): Promise<Appointment> {
    let file_type = file.endsWith('.pdf') ? 'pdf' : 'image';
    const timestamp = Math.floor(Date.now() / 1000);

    return this.appointmentModel
      .findByIdAndUpdate(
        id,
        {
          $addToSet: { files: { id: timestamp, file_name, file, file_type } },
        },
        { new: true }, // Returns the updated document
      )
      .exec();
  }

  async remove(id: string): Promise<Appointment> {
    return this.appointmentModel.findByIdAndDelete(id).exec();
  }

  async removeReport(id: string, image_id: number): Promise<Appointment> {
    console.log('app', id);
    console.log('img', image_id);
    let appointment = await this.appointmentModel.findById(id).exec();
    let files = appointment.files.filter((item: any) => {
      return item.id != image_id;
    });

    console.log('files', files);
    return this.appointmentModel
      .findByIdAndUpdate(
        id,
        {
          files,
        },
        { new: true }, // Returns the updated document
      )
      .exec();
  }

  async generateUniqueAppointmentNumber(): Promise<string> {
    const lastAppointment = await this.appointmentModel
      .findOne()
      .sort({ appointment_number: -1 })
      .exec();
    let lastNumber = 0;

    if (lastAppointment) {
      const lastNumberString = lastAppointment.appointment_number?.replace(
        this.prefix,
        '',
      );
      lastNumber = parseInt(lastNumberString, 10);
    }

    const nextNumber = lastNumber + 1;
    const paddedNumber = nextNumber.toString().padStart(7, '0'); // Adjust length as needed
    return `${this.prefix}${paddedNumber}`;
  }

  getEndDate(startDate) {
    // Convert the string to a Date object
    const dateObj = new Date(startDate);

    // Add one day to the date
    dateObj.setDate(dateObj.getDate() + 1);

    // Format the next date as a string (YYYY-MM-DD)
    return dateObj.toISOString(); // Formats as 'YYYY-MM-DD'
  }
}
