import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import * as hbs from 'hbs';
import { format } from 'date-fns';
import * as fs from 'fs'; // <-- 1. fs मॉड्यूल इम्पोर्ट किया

import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  // <-- 2. SSL सर्टिफिकेट फाइल्स को यहाँ रीड किया
  const httpsOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/dev.profitpeakadvisors.in/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/dev.profitpeakadvisors.in/fullchain.pem'),
  };

  // <-- 3. NestFactory में httpsOptions को पास किया
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    httpsOptions,
  });

  app.setBaseViewsDir(join(__dirname, '..', 'templates'));
  app.setViewEngine('hbs');

  hbs.registerHelper('incrementIndex', function (index) {
    return index + 1;
  });

  hbs.registerHelper('formatDate', (date: Date, formatString: string) => {
    return format(new Date(date), formatString);
  });

  app.useStaticAssets(join(__dirname, '..', '..', 'uploads'), {
    prefix: '/uploads/',
    setHeaders: (res, path, stat) => {
      res.set('Access-Control-Allow-Origin', '*'); // Allow all origins
    },
  });

  const allowedOrigins = [
    'http://localhost:4300',
    'http://localhost:8100',
    'https://localhost',
    'http://localhost:4200', // Localhost for development
  ];

  app.enableCors();
  
  // <-- 4. यह आपके देव पोर्ट (3001) पर रन होगा
  await app.listen(process.env.PORT || 3001);
  console.log('Dev server running on https://profitpeakadvisors.in');
}
bootstrap();
