// src/patients/patients.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { model, Model, Types } from 'mongoose';
import { UserLead } from './user-lead.schema';
import { CreateUserLeadDto } from './dto/create-user-lead.dto';
import { UpdateUserLeadDto } from './dto/update-user-lead.dto';
import { ObjectId } from 'mongoose';
import { types } from 'util';
import { iif } from 'rxjs';
import { LeadsService } from 'src/leads/leads.service';

@Injectable()
export class UserLeadsService {
  constructor(
    @InjectModel(UserLead.name) private readonly model: Model<UserLead>,
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

  async getById(id: string): Promise<UserLead> {
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

  async getStatusCountByUserOld(params) {
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

    // matchStage['$and'] = [
    //   {
    //     created_at: { $gte: startOfDay, $lte: endOfDay },
    //   },
    // ];

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

  async getStatusCountByUser(params) {
    let matchStage: any = {};

    if (params.user) {
      matchStage['user'] = Array.isArray(params.user)
        ? { $in: params.user.map((id) => new Types.ObjectId(id)) }
        : new Types.ObjectId(params.user);
    }

    const page = parseInt(params.page);
    const size = parseInt(params.size);
    const skip = page * size;

    const now = new Date();
    const startOfDay = new Date(now.setUTCHours(0, 0, 0, 0));
    const endOfDay = new Date(now.setUTCHours(23, 59, 59, 999));

    // First: Get the total count of unique users before pagination
    const totalResult = await this.model.aggregate([
      { $match: matchStage },
      {
        $match: {
          $or: [
            { status: 'FRESH' },
            { updated_at: { $gte: startOfDay, $lte: endOfDay } },
          ],
        },
      },
      {
        $group: {
          _id: '$user',
        },
      },
      {
        $count: 'total',
      },
    ]);

    const totalRecords = totalResult.length > 0 ? totalResult[0].total : 0;

    // Then: Fetch paginated data
    const result = await this.model.aggregate([
      { $match: matchStage },
      {
        $match: {
          $or: [
            { status: 'FRESH' },
            { updated_at: { $gte: startOfDay, $lte: endOfDay } },
          ],
        },
      },
      {
        $group: {
          _id: { user: '$user', status: '$status' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.user',
          statuses: {
            $push: {
              status: '$_id.status',
              count: '$count',
            },
          },
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
            total: {
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
            total_dialed: {
              $sum: {
                $map: {
                  input: '$statuses',
                  as: 's',
                  in: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$$s.status', 'FRESH'] },
                          { $ne: ['$$s.status', 'TOTAL'] },
                        ],
                      },
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
      { $sort: { 'userDetails.username': 1 } },
      { $skip: skip },
      { $limit: size },
    ]);

    return {
      total: totalRecords,
      result: result,
    };
  }

  async getReports(params) {
    console.log('report', params);
    let matchStage = {};
    const { from, to, status, size, page, lead_type } = params;
    const skip = page * size;

    // Match by user if provided
    if (params.user) {
      matchStage['user'] = Array.isArray(params.user)
        ? { $in: params.user.map((id) => new Types.ObjectId(id)) }
        : new Types.ObjectId(params.user);
    }

    // Match by status if provided
    if (status) {
      matchStage['status'] = status;
    }

    // Filter by 'from' date if provided
    if (from) {
      matchStage['created_at'] = {
        ...matchStage['created_at'],
        $gte: new Date(from),
      };
    }

    // Filter by 'to' date if provided
    if (to) {
      if (!matchStage['created_at']) {
        matchStage['created_at'] = {};
      }
      matchStage['created_at']['$lte'] = new Date(to);
    }

    if (lead_type && lead_type == 'hot_lead') {
      matchStage['is_hot_lead'] = true;
    } else if (lead_type && lead_type == 'normal_lead') {
      matchStage['is_hot_lead'] = false;
    }
    console.log('query', matchStage);

    const result = await this.model
      .aggregate([
        { $match: matchStage }, // Match the filters based on user, status, date, etc.
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'userDetails',
          },
        },
        { $unwind: '$userDetails' }, // Unwind userDetails for each report
        {
          $project: {
            _id: 1,
            user: '$user',
            userDetails: {
              username: '$userDetails.username',
              mobile: '$userDetails.mobile',
            },
            free_trial: 1,
            follow_up: 1,
            payment: 1,
            mobile: 1,
            name: 1,
            city: 1,
            is_hot_lead: 1,
            status: 1, // Include status field
            created_at: 1, // Include creation date
          },
        },
      ])
      .skip(skip)
      .sort({ created_at: 'desc' })
      .limit(Number(size))
      .exec();

    const totalRecords = await this.model.countDocuments(matchStage).exec();
    return { data: result, total: totalRecords };
    // return result;
  }

  getEndDate(startDate) {
    const dateObj = new Date(startDate);
    dateObj.setDate(dateObj.getDate() + 1); // Move to the next day
    dateObj.setHours(0, 0, 0, 0); // Reset to midnight (start of the new day)
    return dateObj.toISOString(); // Return as UTC time
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

    // if (params.status == 'FRESH') {
    //   query['created_at'] = { $gte: startOfDay, $lte: endOfDay };
    // }

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

  async getByUserIdHotLeads(id: string, params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};

    query = { user: id, is_hot_lead: true };
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

    // if (params.status == 'FRESH') {
    //   query['created_at'] = { $gte: startOfDay, $lte: endOfDay };
    // }

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

  async getAssigneddHotLeads(id: string, params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};

    query = { is_hot_lead: true, status: 'FRESH' };

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

    // if (params.status == 'FRESH') {
    //   query['created_at'] = { $gte: startOfDay, $lte: endOfDay };
    // }

    const patients = await this.model
      .find(query)
      .populate('user')
      .sort({ created_at: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments(query).exec();
    return { data: patients, total: totalRecords };
  }

  async getAssignedLeads(id: string, params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};

    query = { is_hot_lead: false, status: 'FRESH' };

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

    // if (params.status == 'FRESH') {
    //   query['created_at'] = { $gte: startOfDay, $lte: endOfDay };
    // }

    const patients = await this.model
      .find(query)
      .populate('user')
      .sort({ created_at: 'desc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments(query).exec();
    return { data: patients, total: totalRecords };
  }

  async getByUserIdFollowUp(id: string, params) {
    const size = params.size;
    const skip = params.page * params.size;

    let query = {};

    query = { user: id };

    query['status'] = 'FREE_TRIAL';

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

    query['free_trial.free_trial_date'] = {
      $gte: startOfDay,
    };

    const patients = await this.model
      .find(query)
      .sort({ 'free_trial.free_trial_date': 'asc' })
      .skip(skip)
      .limit(size)
      .exec();
    const totalRecords = await this.model.countDocuments(query).exec();
    return { data: patients, total: totalRecords };
  }

  async findBy(query: Record<string, any>): Promise<UserLead[]> {
    return this.model.find(query).exec();
  }

  async findByOne(query: Record<string, any>): Promise<UserLead> {
    return this.model.findOne(query).exec();
  }

  async update(
    id: string,
    updatePatientDto: UpdateUserLeadDto,
  ): Promise<UserLead> {
    const updateFields: any = {};

    // ✅ Update top-level fields dynamically (excluding nested ones)
    Object.keys(updatePatientDto).forEach((key) => {
      if (!['payment', 'free_trial', 'follow_up'].includes(key)) {
        updateFields[key] = updatePatientDto[key];
      }
    });

    // ✅ Dynamically update only the provided fields inside `payment`
    if (updatePatientDto.payment) {
      Object.keys(updatePatientDto.payment).forEach((key) => {
        if (key === 'payment_date') {
          const parsedDate = new Date(updatePatientDto.payment[key]);
          if (!isNaN(parsedDate.getTime())) {
            updateFields[`payment.${key}`] = parsedDate;
          }
        } else {
          updateFields[`payment.${key}`] = updatePatientDto.payment[key];
        }
      });
    }

    // ✅ Dynamically update `free_trial` fields with date conversion
    if (updatePatientDto.free_trial) {
      Object.keys(updatePatientDto.free_trial).forEach((key) => {
        if (key === 'free_trial_date') {
          const parsedDate = new Date(updatePatientDto.free_trial[key]);
          if (!isNaN(parsedDate.getTime())) {
            updateFields[`free_trial.${key}`] = parsedDate;
          }
        } else {
          updateFields[`free_trial.${key}`] = updatePatientDto.free_trial[key];
        }
      });
    }

    // ✅ Dynamically update `follow_up` fields with date conversion
    if (updatePatientDto.follow_up) {
      Object.keys(updatePatientDto.follow_up).forEach((key) => {
        if (key === 'expected_payment_date') {
          const parsedDate = new Date(updatePatientDto.follow_up[key]);
          if (!isNaN(parsedDate.getTime())) {
            updateFields[`follow_up.${key}`] = parsedDate;
          }
        } else {
          updateFields[`follow_up.${key}`] = updatePatientDto.follow_up[key];
        }
      });
    }

    // ✅ Always update the timestamp
    updateFields.updated_at = new Date();

    // ✅ Perform update using `$set` to **only modify provided fields**
    const updatedUserLead = await this.model
      .findByIdAndUpdate(id, { $set: updateFields }, { new: true })
      .exec();

    if (!updatedUserLead) {
      throw new NotFoundException(`Patient #${id} not found`);
    }

    return updatedUserLead;
  }

  async updateOld(
    id: string,
    updatePatientDto: UpdateUserLeadDto,
  ): Promise<UserLead> {
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

    updatePatientDto.updated_at = new Date();

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

  async remove(id: string): Promise<UserLead> {
    const deletedPatient = await this.model.findByIdAndDelete(id).exec();
    if (!deletedPatient) {
      throw new NotFoundException(`Patient #${id} not found`);
    }
    return deletedPatient;
  }

  async getLeadHistory(query: Record<string, any>): Promise<UserLead[]> {
    return this.model.find(query).exec();
  }

  async globalSearch(query: string): Promise<UserLead[]> {
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

    const page = parseInt(params.page);
    const size = parseInt(params.size);
    const skip = page * size;

    console.log('page', page);
    console.log('size', size);

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

    const matchQuery = {
      ...matchStage,
      'payment.payment_date': {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    };

    const [result, totalCountArr] = await Promise.all([
      this.model.aggregate([
        { $match: matchQuery },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'userDetails',
          },
        },
        { $unwind: '$userDetails' },
        {
          $project: {
            _id: 1,
            mobile: 1,
            city: 1,
            name: '$payment.name',
            payment_amount: '$payment.payment_amount',
            payment_mode: '$payment.payment_mode',
            payment_details: '$payment.payment_details',
            payment_date: '$payment.payment_date',
            email_status: '$payment.email_status',
            userDetails: {
              username: '$userDetails.username',
              mobile: '$userDetails.mobile',
            },
          },
        },
        { $skip: skip },
        { $limit: size },
      ]),
      this.model.countDocuments(matchQuery),
    ]);

    const overallTotal = result.reduce(
      (sum, payment) => sum + Number(payment.payment_amount),
      0,
    );

    return {
      total: totalCountArr,
      totalPayment: overallTotal,
      payments: result,
    };
  }

  async deleteByIds(ids: string[]): Promise<any> {
    const objectIds = ids.map((id) => new Types.ObjectId(id)); // Convert to ObjectId
    return await this.model.deleteMany({ _id: { $in: objectIds } });
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
