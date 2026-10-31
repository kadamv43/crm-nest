import {
  attendanceDate,
  attendanceDayRange,
  daysInRange,
  isRealDay,
  nextAutoLogout,
  parseDayRange,
} from './time.util';

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

describe('parseDayRange (date filters on the lists)', () => {
  const iso = (d: Date | undefined) => d?.toISOString();

  it('one plain date is that whole India day, both ends included', () => {
    const r = parseDayRange('2025-03-10', '2025-03-10');
    expect(iso(r.gte)).toBe('2025-03-09T18:30:00.000Z'); // 00:00 India time
    expect(iso(r.lte)).toBe('2025-03-10T18:29:59.999Z'); // 23:59:59.999 India time
  });

  it('a range runs from the start of the first day to the end of the last', () => {
    const r = parseDayRange('2025-03-10', '2025-03-12');
    expect(iso(r.gte)).toBe('2025-03-09T18:30:00.000Z');
    expect(iso(r.lte)).toBe('2025-03-12T18:29:59.999Z');
  });

  it('only one end given means just that day', () => {
    const only = parseDayRange('2025-03-10');
    expect(iso(only.gte)).toBe('2025-03-09T18:30:00.000Z');
    expect(iso(only.lte)).toBe('2025-03-10T18:29:59.999Z');
    const onlyTo = parseDayRange(undefined, '2025-03-10');
    expect(iso(onlyTo.gte)).toBe('2025-03-09T18:30:00.000Z');
    expect(iso(onlyTo.lte)).toBe('2025-03-10T18:29:59.999Z');
  });

  it('treats the text "null" (what an unfinished range sends) as not given', () => {
    const r = parseDayRange('2025-03-10', 'null');
    expect(iso(r.gte)).toBe('2025-03-09T18:30:00.000Z');
    expect(iso(r.lte)).toBe('2025-03-10T18:29:59.999Z');
    expect(parseDayRange('null', 'null')).toBeNull();
  });

  it.each([
    [undefined, undefined],
    ['', ''],
    ['   ', '   '],
    ['abc', 'xyz'],
    ['2025-02-30', '2025-13-01'],
    ['10-03-2025', '2025/03/10'],
    [null, null],
    [123, 456],
    [['2025-03-10'], { a: 1 }],
  ])('ignores unusable values %p %p', (from, to) => {
    expect(parseDayRange(from as any, to as any)).toBeNull();
  });

  it('one good end and one bad end still gives that day', () => {
    const r = parseDayRange('abc', '2025-03-10');
    expect(iso(r.gte)).toBe('2025-03-09T18:30:00.000Z');
    expect(iso(r.lte)).toBe('2025-03-10T18:29:59.999Z');
  });

  it('a full timestamp is used exactly as given', () => {
    const r = parseDayRange('2025-03-10T04:00:00.000Z', '2025-03-10T12:00:00.000Z');
    expect(iso(r.gte)).toBe('2025-03-10T04:00:00.000Z');
    expect(iso(r.lte)).toBe('2025-03-10T12:00:00.000Z');
  });

  it('a leap day and month ends are real days', () => {
    expect(parseDayRange('2024-02-29', '2024-02-29')).not.toBeNull();
    expect(parseDayRange('2025-02-29', '2025-02-29')).toBeNull();
    const r = parseDayRange('2025-12-31', '2025-12-31');
    expect(iso(r.lte)).toBe('2025-12-31T18:29:59.999Z');
  });

  it('an end before the start is kept as given, so it simply matches nothing', () => {
    const r = parseDayRange('2025-03-12', '2025-03-10');
    expect(r.gte.getTime()).toBeGreaterThan(r.lte.getTime());
  });

  it('trims spaces', () => {
    expect(parseDayRange(' 2025-03-10 ', ' 2025-03-10 ')).not.toBeNull();
  });
});

describe('attendanceDayRange (what the smart view covers)', () => {
  const iso = (d: Date) => d.toISOString();

  it('one day runs from 8:00 AM to 7:59:59.999 AM the next morning, India time', () => {
    const r = attendanceDayRange('2025-03-10');
    expect(iso(r.start)).toBe('2025-03-10T02:30:00.000Z'); // 08:00 India
    expect(iso(r.end)).toBe('2025-03-11T02:29:59.999Z'); // 07:59:59.999 India next day
  });

  it('a range ends at the end of its last day', () => {
    const r = attendanceDayRange('2025-03-10', '2025-03-12');
    expect(iso(r.start)).toBe('2025-03-10T02:30:00.000Z');
    expect(iso(r.end)).toBe('2025-03-13T02:29:59.999Z');
  });

  it('agrees with attendanceDate: the start is the first moment of the day, the end the last', () => {
    const r = attendanceDayRange('2025-03-10');
    expect(attendanceDate(r.start)).toBe('2025-03-10');
    expect(attendanceDate(new Date(r.start.getTime() - 1))).toBe('2025-03-09');
    expect(attendanceDate(r.end)).toBe('2025-03-10');
    expect(attendanceDate(new Date(r.end.getTime() + 1))).toBe('2025-03-11');
  });

  it('works across month, year and leap-day ends', () => {
    expect(iso(attendanceDayRange('2025-12-31').end)).toBe('2026-01-01T02:29:59.999Z');
    expect(iso(attendanceDayRange('2024-02-29').end)).toBe('2024-03-01T02:29:59.999Z');
  });

  it('days are 24 hours long, back to back with no gap or overlap', () => {
    const mon = attendanceDayRange('2025-03-10');
    const tue = attendanceDayRange('2025-03-11');
    expect(tue.start.getTime() - mon.end.getTime()).toBe(1);
    expect(mon.end.getTime() - mon.start.getTime() + 1).toBe(24 * 60 * 60 * 1000);
  });
});

describe('isRealDay / daysInRange', () => {
  it.each(['2025-03-10', '2024-02-29', '2025-12-31', '2025-01-01'])('%s is a real day', (d) => {
    expect(isRealDay(d)).toBe(true);
  });

  it.each(['2025-02-29', '2025-13-01', '2025-00-10', '2025-03-32', '10-03-2025', '2025-3-1', '2025/03/10', '', 'abc', ' 2025-03-10', '2025-03-10T00:00', null, undefined, 20250310])(
    '%p is not',
    (d) => {
      expect(isRealDay(d as any)).toBe(false);
    },
  );

  it('counts both end days', () => {
    expect(daysInRange('2025-03-10', '2025-03-10')).toBe(1);
    expect(daysInRange('2025-03-10', '2025-03-12')).toBe(3);
    expect(daysInRange('2025-03-01', '2025-03-31')).toBe(31);
    expect(daysInRange('2025-03-01', '2025-04-01')).toBe(32);
    expect(daysInRange('2024-02-28', '2024-03-01')).toBe(3); // leap day
    expect(daysInRange('2024-12-31', '2025-01-01')).toBe(2); // year end
  });
});
