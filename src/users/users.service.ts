import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './user.schema';
import * as bcrypt from 'bcrypt';
import { EmailService } from 'src/email/email.service';
import { never } from 'rxjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private emailService: EmailService,
  ) {}

  async create(createUserDto: User): Promise<any> {
    const createdUser = new this.userModel(createUserDto);
    return  (await createdUser.save())
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByField(queryData): Promise<User> {
    const user = await this.userModel.findOne(queryData).exec();
    return user;
  }

  async update(id: string, updateUserDto: User): Promise<User> {
    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updateUserDto, { new: true })
      .exec();
    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return updatedUser;
  }

  async remove(id: string): Promise<User> {
    const deletedUser = await this.userModel.findByIdAndDelete(id).exec();
    if (!deletedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return deletedUser;
  }

  async forgotPasswordEmail(id: string): Promise<User> {
    let randomString = await this.generateRandomString(6);
    const updatedUser = await this.userModel
      .findByIdAndUpdate(
        id,
        {
          otp: randomString,
        },
        { new: true },
      )
      .exec();

    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const to = updatedUser.email;
    const subject = 'Genomics Forgot password email';
    const text = 'Your code for reset password is ' + randomString;
    await this.emailService.sendMail(to, subject, text);

    return updatedUser;
  }

  async resetPassword(id: string, data: any): Promise<User> {
    const updatedUser = await this.userModel.findById(id).exec();
    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (updatedUser.otp !== data.otp) {
      throw new UnauthorizedException('invalid code');
    }

    const salt = 10;
    let hashedPassword = await bcrypt.hash(data.password, salt);
    this.userModel
      .findByIdAndUpdate(
        id,
        {
          otp: '',
          password: hashedPassword,
        },
        { new: true },
      )
      .exec();

    return updatedUser;
  }

  async findBy(query: Record<string, any>): Promise<User[]> {
    return this.userModel.find(query).exec();
  }

  async generateRandomString(length: number) {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  async validatePassword(
    plainPassword: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }
}
