import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class CheckAccountExpiryMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (req.user['branch']['expiry_date'] < new Date()) {
      throw new ForbiddenException('Your Account is Expired');
    }
    next(); // Pass request to the next middleware or controller
  }
}
