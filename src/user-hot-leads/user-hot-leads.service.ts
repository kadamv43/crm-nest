import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { model, Model, Types } from 'mongoose';
import { CreateUserLeadDto } from './dto/create-user-lead.dto';
import { UpdateUserLeadDto } from './dto/update-user-lead.dto';
import { ObjectId } from 'mongoose';
import { types } from 'util';
import { iif } from 'rxjs';
import { UserHotLead } from './user-hot-lead.schema';

@Injectable()
export class UserHotLeadsService {
  constructor(
    @InjectModel(UserHotLead.name) private readonly model: Model<UserHotLead>,
  ) {}
  async create(createDto: CreateUserLeadDto[]) {
    // const { mobile } = createDto;
    // const existingPatient = await this.model.findOne({ mobile }).exec();

    // if (existingPatient) {
    //   return existingPatient;
    // }
    return await this.model.insertMany(createDto);
    // return createdPatient.save();
  }

  async findAll(params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};
    if (params.q) {
      const regex = new RegExp(params.q, 'i'); // 'i' makes it case-insensitive

      query = {
        $or: [
          { patient_number: !isNaN(params.q) ? Number(params.q) : 0 },
          { first_name: { $regex: regex } },
          { last_name: { $regex: regex } },
          { email: { $regex: regex } },
          { mobile: { $regex: regex } },
        ],
      };
    }

    const patients = await this.model
      .find(query)
      .sort({ patient_number: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments().exec();
    return { data: patients, total: totalRecords };
  }

  async getById(id: string): Promise<UserHotLead> {
    const patient = await this.model.findById(id).exec();
    if (!patient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return patient;
  }

  async getFreeTrialData(params) {
    let query = {};
    let matchStage = {};

    matchStage['status'] = 'FREE_TRIAL';

    if (params.user) {
      matchStage['user'] = Array.isArray(params.user)
        ? { $in: params.user.map((id) => new Types.ObjectId(id)) }
        : new Types.ObjectId(params.user);
    }

    const today = new Date();
    const startOfDay = new Date(today.setUTCHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setUTCHours(23, 59, 59, 999));

    // Add date filter for free_trial_date
    matchStage['free_trial.free_trial_date'] = {
      $gte: startOfDay,
      $lte: endOfDay,
    };

    const freeTrials = await this.model
      .find(matchStage)
      .populate('user')
      .sort({ created_at: 'desc' })
      .exec();

    const totalRecords = await this.model.countDocuments(matchStage).exec();
    return { data: freeTrials, total: totalRecords };
  }

  async getFreeTrialDataLastWeek(id: string, params) {
    const size = params.size;
    const skip = params.page * params.size;

    let matchStage: any = {};

    // Filter by status
    matchStage['status'] = 'FREE_TRIAL';
    matchStage['user'] = id;

    // Filter by user (single or multiple)
    const today = new Date();

    // Start of 7 days ago
    const startDate = new Date(today);
    startDate.setUTCDate(today.getUTCDate() - 7);
    startDate.setUTCHours(0, 0, 0, 0);

    // End of yesterday
    const endDate = new Date(today);
    endDate.setUTCDate(today.getUTCDate() - 1);
    endDate.setUTCHours(23, 59, 59, 999);

    // Add date filter for free_trial_date (last 7 days excluding today)
    matchStage['free_trial.free_trial_date'] = {
      $gte: startDate,
      $lte: endDate,
    };
    // Fetch free trials
    const freeTrials = await this.model
      .find(matchStage)
      .populate('user')
      .skip(skip)
      .limit(size)
      .sort({ created_at: -1 }) // Use -1 for descending order
      .exec();

    // Count total records
    const totalRecords = await this.model.countDocuments(matchStage).exec();

    return { data: freeTrials, total: totalRecords };
  }

  async getPaymentsDoneData(params) {
    let query = {};

    query['status'] = 'PAYMENT_DONE';

    if (params.user) {
      query = {
        ...query,
        $and: [{ branch: new Types.ObjectId(params.user) }],
      };
    }

    if (params.branch) {
      query = {
        ...query,
        $and: [{ branch: params.branch }],
      };
    }

    const paymentsDone = await this.model
      .find(query)
      .populate('user')
      .sort({ created_at: 'desc' })
      .exec();

    const totalRecords = await this.model.countDocuments(query).exec();
    return { data: paymentsDone, total: totalRecords };
  }

  async getTodaysPaymentsDoneData(params) {
    let query: any = { status: 'PAYMENT_DONE' };

    if (params.user) {
      query['user'] = new Types.ObjectId(params.user);
    }

    if (params.branch) {
      query['branch'] = new Types.ObjectId(params.branch);
    }

    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    query['payment.payment_date'] = { $gte: startOfDay, $lte: endOfDay };

    const paymentsDone = await this.model.aggregate([
      { $match: query }, // Filter by status, user, branch, and date
      {
        $group: {
          _id: null,
          totalAmount: {
            $sum: { $toDouble: '$payment.payment_amount' }, // Convert and sum amount
          },
          data: { $push: '$$ROOT' }, // Store full records
        },
      },
    ]);

    // Get correct total count
    const totalRecords = paymentsDone.length ? paymentsDone[0].data.length : 0;

    return {
      data: paymentsDone.length ? paymentsDone[0].data : [],
      total: totalRecords,
      totalAmount: paymentsDone.length ? paymentsDone[0].totalAmount : 0,
    };
  }

  async getTodaysExpectedPayment(params) {
    let query: any = { status: 'EXPECTED_PAYMENT' };

    if (params.user) {
      query['user'] = new Types.ObjectId(params.user);
    }

    if (params.branch) {
      query['branch'] = new Types.ObjectId(params.branch);
    }

    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    query['follow_up.expected_payment_date'] = {
      $gte: startOfDay,
      $lte: endOfDay,
    };

    const paymentsDone = await this.model.aggregate([
      { $match: query }, // Filter by status, user, branch, and date
      {
        $group: {
          _id: null,
          totalAmount: {
            $sum: { $toDouble: '$follow_up.expected_payment' }, // Convert and sum amount
          },
          data: { $push: '$$ROOT' }, // Store full records
        },
      },
    ]);

    // Get correct total count
    const totalRecords = paymentsDone.length ? paymentsDone[0].data.length : 0;

    return {
      data: paymentsDone.length ? paymentsDone[0].data : [],
      total: totalRecords,
      totalAmount: paymentsDone.length ? paymentsDone[0].totalAmount : 0,
    };
  }

  async getStatusCountByUser(params) {
    let matchStage = {};

    if (params.user) {
      matchStage['user'] = Array.isArray(params.user)
        ? { $in: params.user.map((id) => new Types.ObjectId(id)) }
        : new Types.ObjectId(params.user);
    }

    const now = new Date();

    const startOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    matchStage['$or'] = [
      {
        created_at: { $gte: startOfDay, $lte: endOfDay },
        status: { $nin: ['FREE_TRIAL', 'PAYMENT_DONE'] },
      },
      {
        status: 'FREE_TRIAL',
        free_trial_date: { $gte: startOfDay, $lte: endOfDay },
      },
      {
        status: 'PAYMENT_DONE',
        payment_date: { $gte: startOfDay, $lte: endOfDay },
      },
    ];

    const result = await this.model.aggregate([
      { $match: matchStage }, // 🔍 Filter by user if provided
      {
        $group: {
          _id: { user: '$user', status: '$status' },
          count: { $sum: 1 }, // Count occurrences of each status
        },
      },
      {
        $group: {
          _id: '$_id.user',
          statuses: { $push: { status: '$_id.status', count: '$count' } },
          total: { $sum: '$count' }, // Total records for the user
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      { $unwind: '$userDetails' },
      {
        $project: {
          _id: 0,
          user: '$_id',
          userDetails: {
            username: '$userDetails.username',
            mobile: '$userDetails.mobile',
          },
          status: {
            total: '$total',
            fresh: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [{ $eq: ['$$s.status', 'FRESH'] }, '$$s.count', 0],
                  },
                },
              },
            },
            callback: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      { $eq: ['$$s.status', 'CALLBACK'] },
                      '$$s.count',
                      0,
                    ],
                  },
                },
              },
            },
            free_trial: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      { $eq: ['$$s.status', 'FREE_TRIAL'] },
                      '$$s.count',
                      0,
                    ],
                  },
                },
              },
            },
            ringing: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [{ $eq: ['$$s.status', 'RINGING'] }, '$$s.count', 0],
                  },
                },
              },
            },
            switched_off: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      { $eq: ['$$s.status', 'SWITCHED_OFF'] },
                      '$$s.count',
                      0,
                    ],
                  },
                },
              },
            },
            dead: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [{ $eq: ['$$s.status', 'DEAD'] }, '$$s.count', 0],
                  },
                },
              },
            },
            not_reachable: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      { $eq: ['$$s.status', 'NOT_REACHABLE'] },
                      '$$s.count',
                      0,
                    ],
                  },
                },
              },
            },
            not_interested: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      { $eq: ['$$s.status', 'NOT_INTERESTED'] },
                      '$$s.count',
                      0,
                    ],
                  },
                },
              },
            },
            expected_payment: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      { $eq: ['$$s.status', 'EXPECTED_PAYMENT'] },
                      '$$s.count',
                      0,
                    ],
                  },
                },
              },
            },
            payment_done: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      { $eq: ['$$s.status', 'PAYMENT_DONE'] },
                      '$$s.count',
                      0,
                    ],
                  },
                },
              },
            },
          },
        },
      },
    ]);

    return result;
  }

  async getByUserId(id: string, params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};

    query = { user: id };
    if (params.status) {
      query['status'] = params.status;
    }

    const now = new Date();

    const startOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    if (params.status == 'FRESH') {
      query['created_at'] = { $gte: startOfDay, $lte: endOfDay };
    }

    if (params.status == 'FREE_TRIAL') {
      query['free_trial.free_trial_date'] = {
        $gte: startOfDay,
        $lte: endOfDay,
      };
    }

    const patients = await this.model
      .find(query)
      .sort({ created_at: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments(query).exec();
    return { data: patients, total: totalRecords };
  }

  async findBy(query: Record<string, any>): Promise<UserHotLead[]> {
    return this.model.find(query).exec();
  }

  async findByOne(query: Record<string, any>): Promise<UserHotLead> {
    return this.model.findOne(query).exec();
  }

  async update(
    id: string,
    updatePatientDto: UpdateUserLeadDto,
  ): Promise<UserHotLead> {
    if (updatePatientDto.status == 'PAYMENT_DONE') {
    }

    if (updatePatientDto?.payment) {
      const paymentDate = updatePatientDto.payment.payment_date;
      if (paymentDate && !(paymentDate instanceof Date)) {
        const parsedDate = new Date(paymentDate);
        if (!isNaN(parsedDate.getTime())) {
          updatePatientDto.payment.payment_date = parsedDate;
        } else {
          console.error('Invalid payment_date:', paymentDate);
        }
      }
    }

    if (updatePatientDto?.free_trial?.free_trial_date) {
      const paymentDate = updatePatientDto.free_trial.free_trial_date;
      if (paymentDate && !(paymentDate instanceof Date)) {
        const parsedDate = new Date(paymentDate);
        if (!isNaN(parsedDate.getTime())) {
          updatePatientDto.free_trial.free_trial_date = parsedDate;
        } else {
          console.error('Invalid payment_date:', paymentDate);
        }
      }
    }

    if (updatePatientDto?.follow_up?.expected_payment_date) {
      const paymentDate = updatePatientDto.follow_up.expected_payment_date;
      if (paymentDate && !(paymentDate instanceof Date)) {
        const parsedDate = new Date(paymentDate);
        if (!isNaN(parsedDate.getTime())) {
          updatePatientDto.follow_up.expected_payment_date = parsedDate;
        } else {
          console.error('Invalid payment_date:', paymentDate);
        }
      }
    }

    const existingPatient = await this.model
      .findByIdAndUpdate(id, updatePatientDto, { new: true })
      .exec();
    if (!existingPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return existingPatient;
  }

  async insertData(data: any[]): Promise<any> {
    try {
      const insertedData = await this.model.insertMany(data);
      return { message: 'Data inserted successfully', insertedData };
    } catch (error) {
      throw new Error(`Failed to insert data: ${error.message}`);
    }
  }

  async remove(id: string): Promise<UserHotLead> {
    const deletedPatient = await this.model.findByIdAndDelete(id).exec();
    if (!deletedPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return deletedPatient;
  }

  async globalSearch(query: string): Promise<UserHotLead[]> {
    const searchRegex = new RegExp(query, 'i'); // 'i' makes it case insensitive
    return this.model
      .find({
        $or: [
          { first_name: searchRegex },
          { last_name: searchRegex },
          { email: searchRegex },
          { mobile: searchRegex },
        ],
      })
      .exec();
  }

  async importData(jsonData) {
    for (const data of jsonData) {
      const item = new this.model({
        mobile: data['mobile'],
        name: data['name'],
        city: data['city'],
      });
      await item.save();
    }
  }

  async getCurrentMonthPaymentDoneByUserId(id) {
    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ); // First day of the month
    const endOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
      23,
      59,
      59,
    ); //
    //  Last day of the month

    const result = await this.model.aggregate([
      {
        $match: {
          user: id, // Filter by user ID
          status: 'PAYMENT_DONE', // Filter only completed payments
          'payment.payment_date': {
            $gte: startOfMonth,
            $lte: endOfMonth,
          },
        },
      },
      {
        $group: {
          _id: '$user',
          totalPayment: {
            $sum: { $toDouble: '$payment.payment_amount' }, // Convert string to number and sum
          },
        },
      },
    ]);

    return result.length > 0 ? result[0].totalPayment : 0; // Return total or 0 if no payments
  }

  async getCurrentMonthTeamPaymentDone(params) {
    let matchStage: any = {
      status: 'PAYMENT_DONE',
    };

    if (params.user && Array.isArray(params.user) && params.user.length > 0) {
      matchStage['user'] = {
        $in: params.user.map((id) => new Types.ObjectId(id)),
      };
    }

    const startOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );
    const endOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
      23,
      59,
      59,
    );

    const result = await this.model.aggregate([
      {
        $match: {
          ...matchStage,
          'payment.payment_date': {
            $gte: startOfMonth,
            $lte: endOfMonth,
          },
        },
      },
      {
        $lookup: {
          from: 'users', // Assuming your user collection is 'users'
          localField: 'user',
          foreignField: '_id',
          as: 'userDetails',
        },
      },
      {
        $unwind: '$userDetails', // Convert user array to object
      },
      {
        $project: {
          _id: 0,
          name: 1, // Include the payer's name
          mobile: 1, // Include the payer's mobile
          city: 1, // Include city if available
          payment_amount: '$payment.payment_amount',
          payment_mode: '$payment.payment_mode',
          payment_details: '$payment.payment_details',
          payment_date: '$payment.payment_date',
          userDetails: {
            username: '$userDetails.username',
            mobile: '$userDetails.mobile',
          },
        },
      },
    ]);

    // Calculate overall total payment sum
    const overallTotal = result.reduce(
      (sum, payment) => sum + Number(payment.payment_amount),
      0,
    );

    return {
      totalPayment: overallTotal,
      payments: result,
    };
  }

  async getTodayTotalPayment(userId: string) {
    const userObjectId = new Types.ObjectId(userId);

    // Get today's date range (midnight to 23:59:59)
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));

    const result = await this.model.aggregate([
      {
        $match: {
          user: userObjectId, // Filter by user ID
          status: 'PAYMENT_DONE', // Only completed payments
          'payment.payment_date': {
            $gte: startOfDay,
            $lte: endOfDay,
          },
        },
      },
      {
        $group: {
          _id: '$user',
          totalPayment: {
            $sum: { $toDouble: '$payment.payment_amount' }, // Convert to number and sum
          },
        },
      },
    ]);

    return result.length > 0 ? result[0].totalPayment : 0; // Return total or 0 if no payments
  }

  async getTodayTotalPaymentByBranch(branchId: string) {
    const branchObjectId = new Types.ObjectId(branchId);

    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );
    const endOfDay = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    // 1️⃣ Fetch all users from the branch with roles 'teamlead' or 'employee'
    const users = await this.model.find(
      { branch: branchObjectId }, // Filter by branch and role
    );

    if (users.length === 0) return { total: 0, data: [] }; // Return early if no users exist

    const userIds = users.map((user) => user?.user); // Extract user IDs

    // 2️⃣ Fetch payments for those users
    const payments = await this.model.find(
      {
        user: { $in: userIds },
        status: 'PAYMENT_DONE',
        'payment.payment_mode': 'UPI',
        'payment.payment_date': {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      },
      { user: 1, 'payment.payment_amount': 1 }, // Fetch only necessary fields
    );

    // 3️⃣ Create a user payment mapping
    const userPaymentMap = new Map<string, number>();
    payments.forEach((payment) => {
      const userId = payment.user.toString();
      const amount = parseFloat(payment.payment.payment_amount) || 0;
      userPaymentMap.set(userId, (userPaymentMap.get(userId) || 0) + amount);
    });

    // 4️⃣ Map user data and compute total payment
    let total = 0;
    const data = users.map((user) => {
      const payment = userPaymentMap.get(user._id.toString()) || 0;
      total += payment;
      return {
        ...user.toObject(), // Include all user data
        payment, // Add payment field
      };
    });

    return { total, data };
  }
}
