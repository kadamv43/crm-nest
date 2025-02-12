import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Invoice, InvoiceSchema } from './invoice.schema';
import { AppointmentsService } from 'src/appointments/appointments.service';
import { AppointmentsModule } from 'src/appointments/appointments.module';
import { HttpModule } from '@nestjs/axios';
import { PatientsModule } from 'src/patients/patients.module';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Invoice.name, schema: InvoiceSchema }]),
    AppointmentsModule,
    PatientsModule,
    HttpModule,
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = process.env.UPLOAD_PATH + 'invoice/';
          cb(null, uploadPath);
        },
        filename: (req, file, callback) => {
          const fileExt = extname(file.originalname);
          const fileName = file.originalname;
          callback(null, fileName);
        },
      }),
    }),
  ],
  controllers: [InvoiceController],
  providers: [InvoiceService, AppointmentsService],
  exports: [MongooseModule, InvoiceService],
})
export class InvoiceModule {}
