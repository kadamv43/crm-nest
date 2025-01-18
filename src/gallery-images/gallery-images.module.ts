import { Module } from '@nestjs/common';
import { GalleryImagesController } from './gallery-images.controller';
import { GalleryImagesService } from './gallery-images.service';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { GalleryImage, GalleryImageSchema } from './gallery-image.schema';
import { extname } from 'path';
import * as fs from 'fs';

@Module({
  controllers: [GalleryImagesController],
  imports: [
    MongooseModule.forFeature([
      { name: GalleryImage.name, schema: GalleryImageSchema },
    ]),
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = process.env.UPLOAD_PATH + 'gallery/';

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
  providers: [GalleryImagesService],
})
export class GalleryImagesModule {}
