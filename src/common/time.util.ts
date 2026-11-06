// Business time is India time (Asia/Kolkata). India has no daylight saving,
// so it is always exactly UTC+05:30 and plain arithmetic is safe.
const HOUR = 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * HOUR;

/** A new attendance day starts at 8 AM India time. */
export const ATTENDANCE_DAY_START_HOUR = 8;

/** Everyone is logged out at 11 PM India time. */
export const AUTO_LOGOUT_HOUR = 23;

/**
 * The attendance day a moment belongs to, as "YYYY-MM-DD".
 *
 * The day runs from 8:00 AM to 7:59:59 AM the next morning, so a login at
 * 11:30 PM or at 2 AM still belongs to the day that started at 8 AM, and the
 * next attendance day only begins at 8 AM.
 */
export function attendanceDate(
  now: Date = new Date(),
  startHour: number = ATTENDANCE_DAY_START_HOUR,
): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS - startHour * HOUR);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The next 11:00 PM India time strictly after `now`. A token issued at
 * 10 AM expires tonight at 11 PM; one issued at 11:30 PM expires at 11 PM the
 * following night.
 */
export function nextAutoLogout(
  now: Date = new Date(),
  hour: number = AUTO_LOGOUT_HOUR,
): Date {
  const wall = new Date(now.getTime() + IST_OFFSET_MS); // UTC fields = India wall clock
  const today =
    Date.UTC(
      wall.getUTCFullYear(),
      wall.getUTCMonth(),
      wall.getUTCDate(),
      hour,
      0,
      0,
      0,
    ) - IST_OFFSET_MS;
  return new Date(today > now.getTime() ? today : today + 24 * HOUR);
}

/**
 * Turns the from/to a screen sends into a time range, or null when neither is
 * usable.
 *
 * A plain date ("2025-03-10") means that whole India-time calendar day, so
 * from=to=2025-03-10 is the 24 hours of that day and both ends are included.
 * A full timestamp is used as it is. Only one end given means just that day.
 * Anything that is not a real date (an empty value, "null", "2025-02-30") is
 * ignored rather than failing the page.
 */
export function parseDayRange(
  from?: unknown,
  to?: unknown,
): { gte: Date; lte: Date } | null {
  const start = parseBoundary(from, 'start');
  const end = parseBoundary(to, 'end');
  if (!start && !end) {
    return null;
  }
  return {
    gte: start ?? parseBoundary(to, 'start'),
    lte: end ?? parseBoundary(from, 'end'),
  };
}

function parseBoundary(value: unknown, edge: 'start' | 'end'): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const text = value.trim();

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) {
    const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
    const utc = new Date(Date.UTC(y, m - 1, d));
    if (utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
      return null; // 2025-02-30 and friends
    }
    const startOfDay = utc.getTime() - IST_OFFSET_MS;
    return new Date(edge === 'start' ? startOfDay : startOfDay + 24 * HOUR - 1);
  }

  // A full timestamp ("2025-03-10T04:00:00.000Z"). Anything looser is refused:
  // JavaScript would happily read "10-03-2025" as 3 October.
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
    return null;
  }
  const when = new Date(text);
  return isNaN(when.getTime()) ? null : when;
}

/** True for a real calendar day written as "YYYY-MM-DD". */
export function isRealDay(text: unknown): text is string {
  if (typeof text !== 'string') {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return false;
  }
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(y, m - 1, d));
  return utc.getUTCMonth() === m - 1 && utc.getUTCDate() === d;
}

/** How many days a range covers, both ends counted ("2025-03-10" to "2025-03-12" is 3). */
export function daysInRange(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / (24 * HOUR)) + 1;
}

/**
 * The moments an attendance-day range covers. Each day runs from 8:00 AM India
 * time to 7:59:59.999 AM the next morning, so "2025-03-10" is
 * Mar 10 08:00 -> Mar 11 07:59:59.999 and a range ends at the end of its last day.
 */
export function attendanceDayRange(
  from: string,
  to: string = from,
  startHour: number = ATTENDANCE_DAY_START_HOUR,
): { start: Date; end: Date } {
  const dayStart = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d, startHour) - IST_OFFSET_MS;
  };
  return {
    start: new Date(dayStart(from)),
    end: new Date(dayStart(to) + 24 * HOUR - 1),
  };
}

/** The hour of the day in India time, 0 to 23. */
export function istHour(now: Date = new Date()): number {
  return new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** The India-time hour a moment falls in, as "YYYY-MM-DD HH" (one value per hour). */
export function istHourSlot(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 13).replace('T', ' ');
}
