import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import * as hbs from 'hbs';
import { format } from 'date-fns';
import * as fs from 'fs'; 

import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  // 1. .env से SSL पाथ लोड करें
  const sslKeyPath = process.env.SSL_KEY_PATH;
  const sslCertPath = process.env.SSL_CERT_PATH;
  
  let httpsOptions = null;

  // 2. यदि .env में पाथ मौजूद हैं, तो ही SSL लोड करें (यह लोकल डेवलपमेंट में एरर आने से बचाएगा)
  if (sslKeyPath && sslCertPath) {
    httpsOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };
  }

  // 3. httpsOptions के साथ ऐप क्रिएट करें (यदि मौजूद हो)
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule, 
    httpsOptions ? { httpsOptions } : {}
  );

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
      res.set('Access-Control-Allow-Origin', '*'); 
    },
  });

  const allowedOrigins = [
    'http://localhost:4300',
    'http://localhost:8100',
    'https://localhost',
    'http://localhost:4200', 
  ];

  app.enableCors();
  
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Dev server running on port ${port} with SSL config from .env`);
}
bootstrap();
