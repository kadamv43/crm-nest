import { attendanceDate, nextAutoLogout } from './time.util';

// India time written the way people say it, converted to a real moment.
const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

describe('attendanceDate (the day starts at 8 AM India time)', () => {
  it.each([
    ['2025-03-10 08:00', '2025-03-10'], // the first moment of the day
    ['2025-03-10 08:05', '2025-03-10'],
    ['2025-03-10 12:00', '2025-03-10'],
    ['2025-03-10 22:59', '2025-03-10'],
    ['2025-03-10 23:30', '2025-03-10'], // after the 11 PM logout: still the same day
    ['2025-03-10 23:59', '2025-03-10'],
    ['2025-03-11 00:00', '2025-03-10'], // midnight does not start a new day
    ['2025-03-11 02:00', '2025-03-10'],
    ['2025-03-11 07:59', '2025-03-10'], // last minute of the day
    ['2025-03-11 08:00', '2025-03-11'], // the next day begins at 8 AM
  ])('%s -> %s', (when, expected) => {
    expect(attendanceDate(ist(when))).toBe(expected);
  });

  it('exact second boundaries', () => {
    expect(attendanceDate(new Date('2025-03-11T07:59:59.999+05:30'))).toBe('2025-03-10');
    expect(attendanceDate(new Date('2025-03-11T08:00:00.000+05:30'))).toBe('2025-03-11');
  });

  it('uses India time, not UTC: 2:29 AM UTC is 7:59 AM in India', () => {
    expect(attendanceDate(new Date('2025-03-11T02:29:59Z'))).toBe('2025-03-10');
    expect(attendanceDate(new Date('2025-03-11T02:30:00Z'))).toBe('2025-03-11');
  });

  it('is correct across month and year ends', () => {
    expect(attendanceDate(ist('2025-01-01 03:00'))).toBe('2024-12-31');
    expect(attendanceDate(ist('2025-01-01 08:00'))).toBe('2025-01-01');
    expect(attendanceDate(ist('2025-03-01 07:00'))).toBe('2025-02-28');
    expect(attendanceDate(ist('2024-03-01 07:00'))).toBe('2024-02-29'); // leap year
  });

  it('the start hour can be changed', () => {
    expect(attendanceDate(ist('2025-03-10 05:30'), 6)).toBe('2025-03-09');
    expect(attendanceDate(ist('2025-03-10 06:00'), 6)).toBe('2025-03-10');
  });
});

describe('nextAutoLogout (11 PM India time)', () => {
  const iso = (d: Date) => d.toISOString();

  it.each([
    ['2025-03-10 08:00', '2025-03-10 23:00'],
    ['2025-03-10 10:00', '2025-03-10 23:00'],
    ['2025-03-10 22:59', '2025-03-10 23:00'],
    ['2025-03-10 02:00', '2025-03-10 23:00'], // early morning: tonight
  ])('login at %s is logged out at %s', (when, expected) => {
    expect(iso(nextAutoLogout(ist(when)))).toBe(iso(ist(expected)));
  });

  it('exactly 11 PM is already past: next night', () => {
    expect(iso(nextAutoLogout(ist('2025-03-10 23:00')))).toBe(iso(ist('2025-03-11 23:00')));
  });

  it('one second before 11 PM still logs out tonight, one second after is tomorrow', () => {
    expect(iso(nextAutoLogout(new Date('2025-03-10T22:59:59+05:30')))).toBe(iso(ist('2025-03-10 23:00')));
    expect(iso(nextAutoLogout(new Date('2025-03-10T23:00:01+05:30')))).toBe(iso(ist('2025-03-11 23:00')));
  });

  it('logging in after 11 PM is allowed and lasts until the next 11 PM', () => {
    expect(iso(nextAutoLogout(ist('2025-03-10 23:30')))).toBe(iso(ist('2025-03-11 23:00')));
    expect(iso(nextAutoLogout(ist('2025-03-11 01:00')))).toBe(iso(ist('2025-03-11 23:00')));
  });

  it('works across month and year ends', () => {
    expect(iso(nextAutoLogout(ist('2025-12-31 23:30')))).toBe(iso(ist('2026-01-01 23:00')));
    expect(iso(nextAutoLogout(ist('2024-02-28 23:30')))).toBe(iso(ist('2024-02-29 23:00')));
  });

  it('uses India time, not UTC: 5:29 PM UTC is 10:59 PM in India', () => {
    expect(iso(nextAutoLogout(new Date('2025-03-10T17:29:00Z')))).toBe('2025-03-10T17:30:00.000Z');
    expect(iso(nextAutoLogout(new Date('2025-03-10T17:31:00Z')))).toBe('2025-03-11T17:30:00.000Z');
  });

  it('is always in the future and never more than 24 hours away', () => {
    for (let h = 0; h < 24 * 4; h++) {
      const now = new Date(Date.UTC(2025, 5, 1, 0, 0) + h * 15 * 60 * 1000);
      const at = nextAutoLogout(now).getTime();
      expect(at).toBeGreaterThan(now.getTime());
      expect(at - now.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    }
  });
});
