import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Appointment, AppointmentSchema } from './appointment.schema';
import { PatientsModule } from 'src/patients/patients.module';
import { DoctorsModule } from 'src/doctors/doctors.module';
import { ProductsModule } from 'src/products/products.module';
import { PdfService } from 'src/services/pdf/pdf.service';
import { DoctorsService } from 'src/doctors/doctors.service';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { FileUploadService } from 'src/services/file-upload/file-upload/file-upload.service';
import { Patient, PatientSchema } from 'src/patients/patients.schema';
import { Product, ProductSchema } from 'src/products/product.schema';
import { Doctor, DoctorSchema } from 'src/doctors/doctor.schema';
import { PatientsService } from 'src/patients/patients.service';
import * as fs from 'fs';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
    PatientsModule,
    DoctorsModule,
    ProductsModule,
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = process.env.UPLOAD_PATH + 'appointment/';

          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true }); // Create parent directories if needed
          }

          console.log(uploadPath);
          cb(null, uploadPath);
        },
        filename: (req, file, callback) => {
          const fileExt = extname(file.originalname);
          const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;
          callback(null, fileName);
        },
      }),
    }),
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    PdfService,
    DoctorsService,
    PatientsService,
    FileUploadService,
  ],
  exports: [AppointmentsService, MongooseModule],
})
export class AppointmentsModule {}
