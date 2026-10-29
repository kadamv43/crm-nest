import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

// India time written the way people say it.
const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

// Only the clock is faked, so token expiry can be tested at exact moments.
const freeze = (when: Date) =>
  jest.useFakeTimers({
    now: when,
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
      'queueMicrotask',
      'performance',
      'hrtime',
    ],
  });

describe('AuthService.loginUser', () => {
  let jwt: JwtService;
  let attendance: { recordLogin: jest.Mock };
  let service: AuthService;

  const branch = { _id: 'B1', status: 'Active', expiry_date: '2099-01-01' };
  const person = (role: string, over: any = {}) => ({
    _id: 'U1',
    first_name: 'Asha',
    last_name: 'K',
    username: 'asha',
    email: 'a@x.com',
    mobile: '9',
    role,
    branch,
    ...over,
  });

  beforeEach(() => {
    jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '10h' } });
    attendance = { recordLogin: jest.fn().mockResolvedValue({}) };
    service = new AuthService(jwt, {} as any, attendance as any);
  });

  afterEach(() => jest.useRealTimers());

  const expiryOf = (token: string) => (jwt.decode(token) as any).exp * 1000;

  describe('the token stops working at 11 PM India time', () => {
    it.each([
      ['2025-03-10 08:00', '2025-03-10 23:00'],
      ['2025-03-10 10:00', '2025-03-10 23:00'],
      ['2025-03-10 02:00', '2025-03-10 23:00'],
      ['2025-03-10 22:00', '2025-03-10 23:00'],
    ])('logging in at %s expires at %s', async (loginAt, expiresAt) => {
      freeze(ist(loginAt));
      const res = await service.loginUser(person('employee'));
      expect(new Date(res.expiresAt).getTime()).toBe(ist(expiresAt).getTime());
      // the real token expires at that moment (to the second)
      expect(Math.abs(expiryOf(res.accessToken) - ist(expiresAt).getTime())).toBeLessThan(2000);
      expect(expiryOf(res.accessToken)).toBeLessThanOrEqual(ist(expiresAt).getTime());
    });

    it('logging in after 11 PM is allowed and lasts until the next 11 PM', async () => {
      freeze(ist('2025-03-10 23:30'));
      const res = await service.loginUser(person('employee'));
      expect(new Date(res.expiresAt).getTime()).toBe(ist('2025-03-11 23:00').getTime());
      expect(res.accessToken).toBeTruthy();
    });

    it('logging in exactly at 11 PM lasts until the next night', async () => {
      freeze(ist('2025-03-10 23:00'));
      const res = await service.loginUser(person('employee'));
      expect(new Date(res.expiresAt).getTime()).toBe(ist('2025-03-11 23:00').getTime());
    });

    it('the token works before 11 PM and is rejected from 11 PM', async () => {
      freeze(ist('2025-03-10 09:00'));
      const { accessToken } = await service.loginUser(person('employee'));

      jest.setSystemTime(ist('2025-03-10 22:58'));
      expect((jwt.verify(accessToken) as any).username).toBe('asha');

      jest.setSystemTime(new Date(ist('2025-03-10 23:00').getTime() + 5000)); // 11:00:05 PM
      expect(() => jwt.verify(accessToken)).toThrow(/jwt expired/);

      jest.setSystemTime(ist('2025-03-11 09:00')); // next morning: needs a new login
      expect(() => jwt.verify(accessToken)).toThrow(/jwt expired/);
    });

    it('applies to every role, superadmin included', async () => {
      freeze(ist('2025-03-10 10:00'));
      for (const role of ['employee', 'teamlead', 'admin', 'superadmin']) {
        const res = await service.loginUser(person(role));
        expect(new Date(res.expiresAt).getTime()).toBe(ist('2025-03-10 23:00').getTime());
      }
    });

    it('tells the browser the server time so a wrong computer clock cannot matter', async () => {
      freeze(ist('2025-03-10 10:00'));
      const res = await service.loginUser(person('employee'));
      expect(new Date(res.serverTime).getTime()).toBe(ist('2025-03-10 10:00').getTime());
    });

    it('keeps the user details in the token', async () => {
      freeze(ist('2025-03-10 10:00'));
      const { accessToken } = await service.loginUser(person('teamlead'));
      expect(jwt.decode(accessToken)).toMatchObject({
        sub: 'U1',
        username: 'asha',
        role: 'teamlead',
        email: 'a@x.com',
        branch: { _id: 'B1' },
      });
    });
  });

  describe('attendance', () => {
    it.each(['employee', 'teamlead', 'admin'])('is recorded for a %s', async (role) => {
      freeze(ist('2025-03-10 08:05'));
      await service.loginUser(person(role));
      expect(attendance.recordLogin).toHaveBeenCalledTimes(1);
      const [userId, branchId, when] = attendance.recordLogin.mock.calls[0];
      expect(userId).toBe('U1');
      expect(branchId).toBe('B1');
      expect(when.getTime()).toBe(ist('2025-03-10 08:05').getTime());
    });

    it('is not recorded for the superadmin, who is not staff', async () => {
      await service.loginUser(person('superadmin'));
      expect(attendance.recordLogin).not.toHaveBeenCalled();
    });

    it('is not recorded and no token is issued when the company is inactive', async () => {
      await expect(
        service.loginUser(person('employee', { branch: { ...branch, status: 'Inactive' } })),
      ).rejects.toThrow(ForbiddenException);
      expect(attendance.recordLogin).not.toHaveBeenCalled();
    });

    it('is not recorded and no token is issued when the company has expired', async () => {
      await expect(
        service.loginUser(person('employee', { branch: { ...branch, expiry_date: '2000-01-01' } })),
      ).rejects.toThrow(/expired/);
      expect(attendance.recordLogin).not.toHaveBeenCalled();
    });

    it('a failure to record it never stops the login', async () => {
      attendance.recordLogin.mockRejectedValue(new Error('db down'));
      const res = await service.loginUser(person('employee'));
      expect(res.accessToken).toBeTruthy();
    });
  });

  describe('wrong credentials', () => {
    it('record nothing', async () => {
      const users: any = { findByField: jest.fn().mockResolvedValue(null) };
      const s = new AuthService(jwt, users, attendance as any);
      await expect(s.validateUser('nobody', 'x')).rejects.toThrow(UnauthorizedException);
      expect(attendance.recordLogin).not.toHaveBeenCalled();
    });
  });
});
