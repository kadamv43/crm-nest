import { DashboardController } from './dashboard.controller';

describe('DashboardController.getReports', () => {
  const userService: any = {
    findOne: jest.fn(),
    findByBranch: jest.fn(),
    findByTeamlead: jest.fn(),
  };
  const userLeadsService: any = { getReports: jest.fn() };
  let controller: DashboardController;

  beforeEach(() => {
    jest.resetAllMocks();
    userLeadsService.getReports.mockResolvedValue({ data: [], total: 0 });
    controller = new DashboardController(userService, userLeadsService);
  });

  it('team lead report covers the team and the team lead', async () => {
    userService.findOne.mockResolvedValue({ role: 'teamlead' });
    userService.findByTeamlead.mockResolvedValue([{ _id: 'e1' }, { _id: 'e2' }]);

    await controller.getReports({} as any, { user: 'tl1', status: 'FRESH' });

    expect(userLeadsService.getReports).toHaveBeenCalledWith(
      expect.objectContaining({
        user: ['e1', 'e2', 'tl1'],
        status: 'FRESH',
      }),
    );
  });

  it('team lead with no team still reports on themself', async () => {
    userService.findOne.mockResolvedValue({ role: 'teamlead' });
    userService.findByTeamlead.mockResolvedValue([]);

    await controller.getReports({} as any, { user: 'tl1' });

    expect(userLeadsService.getReports).toHaveBeenCalledWith(
      expect.objectContaining({ user: ['tl1'] }),
    );
  });

  it('admin report covers the whole branch', async () => {
    userService.findOne.mockResolvedValue({ role: 'admin', branch: 'b1' });
    userService.findByBranch.mockResolvedValue([{ _id: 'a' }, { _id: 'b' }]);

    await controller.getReports({} as any, { user: 'admin1' });

    expect(userService.findByBranch).toHaveBeenCalledWith('b1');
    expect(userLeadsService.getReports).toHaveBeenCalledWith(
      expect.objectContaining({ user: ['a', 'b'] }),
    );
  });

  it('superadmin report uses the company chosen in the query', async () => {
    userService.findOne.mockResolvedValue({ role: 'superadmin' });
    userService.findByBranch.mockResolvedValue([{ _id: 'x' }]);

    await controller.getReports({} as any, { user: 'sa', branch: 'companyB' });

    expect(userService.findByBranch).toHaveBeenCalledWith('companyB');
    expect(userLeadsService.getReports).toHaveBeenCalledWith(
      expect.objectContaining({ user: ['x'] }),
    );
  });

  it('employee report is limited to the employee', async () => {
    userService.findOne.mockResolvedValue({ role: 'employee' });

    await controller.getReports({} as any, { user: 'e9' });

    expect(userLeadsService.getReports).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'e9' }),
    );
  });
});
