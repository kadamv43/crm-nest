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
