import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { AppointmentsModule } from './appointments/appointments.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { DoctorsModule } from './doctors/doctors.module';
import { PatientsModule } from './patients/patients.module';
import { PdfService } from './services/pdf/pdf.service';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { EmailModule } from './email/email.module';
import { FileUploadService } from './services/file-upload/file-upload/file-upload.service';
import { InvoiceModule } from './invoice/invoice.module';
import { UploadsController } from './uploads/uploads.controller';
import { ConfigModule } from '@nestjs/config';
import { ContactDetailsModule } from './contact-details/contact-details.module';
import { BlogModule } from './blog/blog.module';
import { GalleryModule } from './gallery/gallery.module';
import { BannersModule } from './banners/banners.module';
import { GalleryImagesModule } from './gallery-images/gallery-images.module';
import { WebModule } from './web/web.module';
import { OtpModule } from './otp/otp.module';
import { AppConfigModule } from './app-config/app-config.module';
import { BranchesModule } from './branches/branches.module';


@Module({
  imports: [
    ConfigModule.forRoot(),
    MongooseModule.forRoot(process.env.DB),
    AuthModule,
    AppointmentsModule,
    UsersModule,
    ProductsModule,
    DoctorsModule,
    PatientsModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public/assets'), // Path to your static assets directory
      serveRoot: '/assets', // The base URL path to serve the assets
    }),
    EmailModule,
    InvoiceModule,
    ContactDetailsModule,
    BlogModule,
    GalleryModule,
    BannersModule,
    GalleryImagesModule,
    WebModule,
    OtpModule,
    AppConfigModule,
    BranchesModule
  ],
  controllers: [AppController, UploadsController],
  providers: [AppService, PdfService, FileUploadService],
})
export class AppModule {}
