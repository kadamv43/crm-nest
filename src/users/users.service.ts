import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model, Types } from 'mongoose';
import { User, UserDocument } from './user.schema';
import * as bcrypt from 'bcrypt';
import { EmailService } from 'src/email/email.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private emailService: EmailService,
  ) {}

  async create(createUserDto: User, req): Promise<any> {
    createUserDto.admin = createUserDto.admin || null;
    createUserDto.teamlead = createUserDto.teamlead || null;

    if (req.user?.role === 'admin') {
      await this.checkUserAddLimit(req); // Ensure user limit before assignment
      createUserDto.branch = req.user?.branch?._id;
    }

    const existingUser = await this.userModel.findOne({
      username: createUserDto.username,
      branch: createUserDto.branch,
    });

    if (existingUser) {
      throw new ConflictException('Username already exist');
    }

    const createdUser = new this.userModel(createUserDto);
    return await createdUser.save();
  }

  async changePassword(data: any, req): Promise<any> {
    const { password, old_password } = data;
    const existingUser = await this.userModel.findById(req.user['userId']);

    if (!existingUser) {
      throw new ConflictException('user does not exit');
    }

    if (existingUser.password_text == old_password) {
      existingUser.password_text = password;
      existingUser.password = password;
      return existingUser.save();
    } else {
      throw new ConflictException('Old password does not match');
    }
  }

  async checkUserAddLimit(req): Promise<void> {
    const users = await this.findBy({ branch: req.user?.branch?._id });

    if (users.length >= req.user?.branch?.max_users) {
      throw new ForbiddenException('You have reached your maximum user limit');
    }
  }

  async findAll(params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query: any = {};
    if (params.q) {
      const regex = new RegExp(params.q, 'i'); // 'i' makes it case-insensitive
      query = {
        $or: [
          { first_name: { $regex: regex } },
          { last_name: { $regex: regex } },
          { email: { $regex: regex } },
          { mobile: { $regex: regex } },
        ],
      };
    }

    if (params.role) {
      const excludeRoles = params.IsSuperAdmin
        ? ['superadmin']
        : ['superadmin', 'admin'];
      query = {
        ...query,
        $and: [
          ...(query.$and || []),
          { role: params.role },
          { role: { $nin: excludeRoles } },
        ],
      };
    } else {
      query = {
        ...query,
        role: {
          $nin: params.IsSuperAdmin ? ['superadmin'] : ['superadmin', 'admin'],
        },
      };
    }

    if (params.branch) {
      query = {
        ...query,
        $and: [...(query.$and || []), { branch: params.branch }],
      };
    }

    if (params.teamlead) {
      query = {
        ...query,
        $and: [...(query.$and || []), { teamlead: params.teamlead }],
      };
    }

    const users = await this.userModel
      .find(query)
      .populate('branch')
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.userModel.countDocuments(query).exec();
    return { data: users, total: totalRecords };
    // return this.userModel.find({role:'staff'}).exec();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModel.findById(id).populate('branch').exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByField(queryData): Promise<User> {
    const user = await this.userModel
      .findOne(queryData)
      .populate('branch')
      .exec();
    return user;
  }

  async findByTeamlead(teamLeadId): Promise<User[]> {
    const user = await this.userModel
      .find({ teamlead: teamLeadId })
      .populate('branch')
      .exec();
    return user;
  }

  async findByBranch(branchId): Promise<User[]> {
    const user = await this.userModel
      .find({ branch: branchId })
      .populate('branch')
      .exec();
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

  async updateNote(id: string, updateUserDto: UpdateUserDto): Promise<User> {
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
    const subject = 'Forgot password email';
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
    return this.userModel.find(query).populate('branch').exec();
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

  async getTotalTargetAllEmployeeByBranch(query) {
    const branchObjectId = new Types.ObjectId(query?.branch);

    const result = await this.userModel.aggregate([
      {
        $match: {
          branch: branchObjectId, // Filter by branch ID
          role: { $in: ['teamlead', 'employee'] }, // Match roles
        },
      },
      {
        $group: {
          _id: null,
          totalTarget: { $sum: '$target' }, // Sum the target field
        },
      },
    ]);

    return result.length > 0 ? result[0].totalTarget : 0; // Return total or 0 if no users found
  }

  async getTotaltargetOfTeamLead(teamlead) {
    const teamleadObjectId = new Types.ObjectId(teamlead);

    const result = await this.userModel.aggregate([
      {
        $match: {
          teamlead: teamleadObjectId, // Filter by branch ID
          role: 'employee', // Match roles
        },
      },
      {
        $group: {
          _id: null,
          totalTarget: { $sum: '$target' }, // Sum the target field
        },
      },
    ]);

    return result.length > 0 ? result[0].totalTarget : 0; // Return total or 0 if no users found
  }
}
