import { MiddlewareConsumer, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';

import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { PdfService } from './services/pdf/pdf.service';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { EmailModule } from './email/email.module';
import { FileUploadService } from './services/file-upload/file-upload/file-upload.service';
import { UploadsController } from './uploads/uploads.controller';
import { ConfigModule } from '@nestjs/config';
import { OtpModule } from './otp/otp.module';
import { AppConfigModule } from './app-config/app-config.module';
import { BranchesModule } from './branches/branches.module';
import { BanksModule } from './banks/banks.module';
import { UpisModule } from './upis/upis.module';
import { PaymentLinksModule } from './payment-links/payment-links.module';
import { HotLeadsModule } from './hot-leads/hot-leads.module';
import { LeadsModule } from './leads/leads.module';
import { UserLeadsModule } from './user-leads/user-leads.module';
import { SpotIncentiveModule } from './spot-incentive/spot-incentive.module';
import { MonthlyIncentiveModule } from './monthly-incentive/monthly-incentive.module';
import { CheckAccountExpiryMiddleware } from './check-account-expiry.middleware';
import { DayOfferModule } from './day-offer/day-offer.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { IncentiveModule } from './incentive/incentive.module';
import { UserHotLeadsModule } from './user-hot-leads/user-hot-leads.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    MongooseModule.forRoot(process.env.DB),
    AuthModule,
    UsersModule,
    ProductsModule,
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public/assets'), // Path to your static assets directory
      serveRoot: '/assets', // The base URL path to serve the assets
    }),
    EmailModule,
    OtpModule,
    AppConfigModule,
    BranchesModule,
    BanksModule,
    UpisModule,
    PaymentLinksModule,
    HotLeadsModule,
    LeadsModule,
    UserLeadsModule,
    SpotIncentiveModule,
    MonthlyIncentiveModule,
    DayOfferModule,
    DashboardModule,
    IncentiveModule,
    UserHotLeadsModule,
  ],
  controllers: [AppController, UploadsController],
  providers: [AppService, PdfService, FileUploadService],
})
export class AppModule {}
