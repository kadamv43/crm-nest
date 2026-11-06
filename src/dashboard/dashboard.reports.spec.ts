import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DashboardController } from './dashboard.controller';

const oid = () => String(new Types.ObjectId());
const E9 = oid();
const TL1 = oid();

describe('DashboardController: who may see whose numbers', () => {
  const userService: any = {
    findOne: jest.fn(),
    findByBranch: jest.fn(),
    findByTeamlead: jest.fn(),
    getTotalTargetAllEmployeeByBranch: jest.fn(),
    getTotaltargetOfTeamLead: jest.fn(),
  };
  const userLeadsService: any = {
    getReports: jest.fn(),
    getTodaysPaymentsDoneData: jest.fn(),
    getTodaysExpectedPayment: jest.fn(),
    getCurrentMonthTeamPaymentDone: jest.fn(),
    getFreeTrialByUser: jest.fn(),
  };
  let controller: DashboardController;

  // the logged-in caller, as the login token delivers them
  const caller = (role: string, userId: string, branch: string | null = 'b1') => ({
    user: { userId, role, branch: branch ? { _id: branch } : undefined },
  });
  const person = (role: string, _id: string, branch: string | null = 'b1', extra: any = {}) => ({
    _id,
    role,
    branch: branch ? { _id: branch } : undefined,
    ...extra,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    userLeadsService.getReports.mockResolvedValue({ data: [], total: 0 });
    userLeadsService.getTodaysPaymentsDoneData.mockResolvedValue({ data: [], total: 0 });
    userLeadsService.getTodaysExpectedPayment.mockResolvedValue({ data: [], total: 0 });
    controller = new DashboardController(userService, userLeadsService, {} as any);
  });

  describe('reports', () => {
    it('team lead report covers the team and the team lead', async () => {
      userService.findOne.mockResolvedValue(person('teamlead', 'tl1'));
      userService.findByTeamlead.mockResolvedValue([{ _id: 'e1' }, { _id: 'e2' }]);

      await controller.getReports(caller('teamlead', 'tl1') as any, { user: 'tl1', status: 'FRESH' });

      expect(userLeadsService.getReports).toHaveBeenCalledWith(
        expect.objectContaining({ user: ['e1', 'e2', 'tl1'], status: 'FRESH' }),
      );
    });

    it('team lead with no team still reports on themself', async () => {
      userService.findOne.mockResolvedValue(person('teamlead', 'tl1'));
      userService.findByTeamlead.mockResolvedValue([]);

      await controller.getReports(caller('teamlead', 'tl1') as any, { user: 'tl1' });

      expect(userLeadsService.getReports).toHaveBeenCalledWith(expect.objectContaining({ user: ['tl1'] }));
    });

    it('admin report covers the whole branch', async () => {
      userService.findOne.mockResolvedValue(person('admin', 'admin1'));
      userService.findByBranch.mockResolvedValue([{ _id: 'a' }, { _id: 'b' }]);

      await controller.getReports(caller('admin', 'admin1') as any, { user: 'admin1' });

      expect(userService.findByBranch).toHaveBeenCalledWith({ _id: 'b1' });
      expect(userLeadsService.getReports).toHaveBeenCalledWith(expect.objectContaining({ user: ['a', 'b'] }));
    });

    it('superadmin report uses the company chosen in the query', async () => {
      userService.findOne.mockResolvedValue({ _id: 'sa', role: 'superadmin' });
      userService.findByBranch.mockResolvedValue([{ _id: 'x' }]);

      await controller.getReports(caller('superadmin', 'sa', null) as any, { user: 'sa', branch: 'companyB' });

      expect(userService.findByBranch).toHaveBeenCalledWith('companyB');
      expect(userLeadsService.getReports).toHaveBeenCalledWith(expect.objectContaining({ user: ['x'] }));
    });

    it('employee report is limited to the employee', async () => {
      userService.findOne.mockResolvedValue(person('employee', 'e9'));

      await controller.getReports(caller('employee', 'e9') as any, { user: 'e9' });

      expect(userLeadsService.getReports).toHaveBeenCalledWith(expect.objectContaining({ user: 'e9' }));
    });

    it('an employee cannot read a colleague, the team lead or the admin by naming them', async () => {
      for (const target of [person('employee', 'e2'), person('teamlead', 'tl1'), person('admin', 'admin1')]) {
        userService.findOne.mockResolvedValue(target);
        await expect(
          controller.getReports(caller('employee', 'e9') as any, { user: target._id }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(userLeadsService.getReports).not.toHaveBeenCalled();
    });

    it('a team lead can read their own team member but not another team', async () => {
      userService.findByTeamlead.mockResolvedValue([]);
      userService.findOne.mockResolvedValue(person('employee', 'e1', 'b1', { teamlead: 'tl1' }));
      await controller.getReports(caller('teamlead', 'tl1') as any, { user: 'e1' });
      userService.findOne.mockResolvedValue(person('employee', 'e7', 'b1', { teamlead: 'tl2' }));
      await expect(controller.getReports(caller('teamlead', 'tl1') as any, { user: 'e7' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('an admin cannot read another company, and nobody can read the superadmin', async () => {
      userService.findOne.mockResolvedValue(person('admin', 'adminB', 'b2'));
      await expect(controller.getReports(caller('admin', 'admin1') as any, { user: 'adminB' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      userService.findOne.mockResolvedValue({ _id: 'sa', role: 'superadmin' });
      await expect(controller.getReports(caller('admin', 'admin1') as any, { user: 'sa' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('a request that is not logged in is refused', async () => {
      userService.findOne.mockResolvedValue(person('admin', 'admin1'));
      await expect(controller.getReports({} as any, { user: 'admin1' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('the other dashboard figures', () => {
    it('target, free trial and month payments all refuse a person the caller may not look at', async () => {
      userService.findOne.mockResolvedValue(person('admin', 'adminB', 'b2'));
      const req: any = caller('employee', 'e9');
      await expect(controller.getTarget(req, { user: 'adminB' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.getFreeTrialByEmployeeId(req, { user: 'adminB' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(controller.getCurrentMonthPaymentsDone(req, { user: 'adminB' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('an admin who names another company in the address is kept to their own', async () => {
      userService.findOne.mockResolvedValue(person('admin', 'admin1'));
      userService.findByBranch.mockResolvedValue([{ _id: 'a' }]);
      userLeadsService.getCurrentMonthTeamPaymentDone.mockResolvedValue({ totalPayment: 0 });
      await controller.getCurrentMonthPaymentsDone(caller('admin', 'admin1') as any, { user: 'admin1', branch: 'b2' });
      expect(userService.findByBranch).toHaveBeenCalledWith('b1');
    });

    for (const name of ['getTodaysPaymentsDone', 'getTodaysExpectedPayment'] as const) {
      const service = name === 'getTodaysPaymentsDone' ? 'getTodaysPaymentsDoneData' : 'getTodaysExpectedPayment';

      describe(name, () => {
        it('staff naming nobody get their own figures, not everybody\'s', async () => {
          userService.findOne.mockResolvedValue(person('employee', E9));
          await controller[name](caller('employee', E9) as any, {});
          expect(userLeadsService[service]).toHaveBeenCalledWith(expect.objectContaining({ user: E9, branch: 'b1' }));
        });

        it('a team lead naming nobody gets their own', async () => {
          userService.findOne.mockResolvedValue(person('teamlead', TL1));
          await controller[name](caller('teamlead', TL1) as any, {});
          expect(userLeadsService[service]).toHaveBeenCalledWith(expect.objectContaining({ user: TL1 }));
        });

        it('an admin naming nobody gets their own company only', async () => {
          await controller[name](caller('admin', 'admin1') as any, { branch: 'b2' });
          expect(userLeadsService[service]).toHaveBeenCalledWith(expect.objectContaining({ branch: 'b1' }));
        });

        it('the superadmin may leave both out, or pick a company', async () => {
          await controller[name](caller('superadmin', 'sa', null) as any, { branch: 'b2' });
          expect(userLeadsService[service]).toHaveBeenCalledWith(expect.objectContaining({ branch: 'b2' }));
        });

        it('naming someone the caller may not see is refused', async () => {
          userService.findOne.mockResolvedValue(person('employee', 'e2'));
          const id = oid();
          await expect(controller[name](caller('employee', 'e9') as any, { user: id })).rejects.toBeInstanceOf(
            ForbiddenException,
          );
          expect(userLeadsService[service]).not.toHaveBeenCalled();
        });

        it('a junk user id is a clean 400', async () => {
          await expect(controller[name](caller('admin', 'admin1') as any, { user: 'junk' })).rejects.toBeInstanceOf(
            BadRequestException,
          );
        });

        it('not logged in is refused', async () => {
          await expect(controller[name]({} as any, {})).rejects.toBeInstanceOf(ForbiddenException);
        });
      });
    }
  });
});
