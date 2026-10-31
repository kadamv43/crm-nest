// The hourly smart-view email: subject, HTML and a plain-text copy.
// Pure functions, so exactly what people receive can be tested.

export interface SmartViewMailRow {
  userDetails: { username: string };
  status: Record<string, number>;
  attendance: { first_login_at: Date | string } | null;
}

export interface SmartViewMailData {
  companyName: string;
  sentAt: Date;
  range: { from: string; to: string };
  rows: SmartViewMailRow[];
  /** people who logged in out of the company's staff (team leads and employees) */
  loggedIn: { count: number; total: number };
  onlyLoggedIn: boolean;
}

// [key in the status object, heading]
const COLUMNS: [string, string][] = [
  ['carried_forward', 'Carried forward'],
  ['assigned', 'Assigned'],
  ['fresh', 'Fresh'],
  ['total', 'Total'],
  ['total_dialed', 'Dialed'],
  ['callback', 'Callback'],
  ['free_trial', 'Free trial'],
  ['ringing', 'Ringing'],
  ['switched_off', 'Switch off'],
  ['dead', 'Dead'],
  ['not_reachable', 'Not reachable'],
  ['not_interested', 'Not interested'],
  ['expected_payment', 'Expected payment'],
  ['payment_done', 'Payment done'],
];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** 14:05 India time as "2:05 PM" */
export function clockIst(date: Date | string): string {
  const wall = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const h = wall.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(wall.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "30 Oct, 2:00 PM" in India time */
export function stampIst(date: Date): string {
  const wall = new Date(date.getTime() + IST_OFFSET_MS);
  return `${wall.getUTCDate()} ${MONTHS[wall.getUTCMonth()]}, ${clockIst(date)}`;
}

/** "2025-03-10" as "10/03/2025" */
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sum of every column over the rows. */
export function totalsOf(rows: SmartViewMailRow[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [key] of COLUMNS) {
    totals[key] = rows.reduce((sum, r) => sum + (r.status?.[key] ?? 0), 0);
  }
  return totals;
}

export function renderSmartViewMail(data: SmartViewMailData) {
  const period =
    data.range.from === data.range.to
      ? dayLabel(data.range.from)
      : `${dayLabel(data.range.from)} to ${dayLabel(data.range.to)}`;
  const subject = `Smart view - ${data.companyName} - ${stampIst(data.sentAt)}`;
  const totals = totalsOf(data.rows);
  const loggedLine = `Logged in today: ${data.loggedIn.count} of ${data.loggedIn.total} staff`;
  const scopeLine = data.onlyLoggedIn ? 'Showing only people who logged in.' : '';

  // ------------------------------------------------------------------ HTML
  const th = (label: string, left = false) =>
    `<th style="padding:6px 8px;border:1px solid #d9d9d9;background:#f3f4f6;text-align:${left ? 'left' : 'right'};white-space:nowrap;">${escapeHtml(label)}</th>`;
  const td = (value: unknown, left = false, bold = false) =>
    `<td style="padding:6px 8px;border:1px solid #d9d9d9;text-align:${left ? 'left' : 'right'};${bold ? 'font-weight:bold;' : ''}">${escapeHtml(value)}</td>`;

  const head = `<tr>${th('Username', true)}${th('First login', true)}${COLUMNS.map(([, label]) => th(label)).join('')}</tr>`;
  const body = data.rows
    .map((r) => {
      const login = r.attendance ? clockIst(r.attendance.first_login_at) : '-';
      return `<tr>${td(r.userDetails.username, true)}${td(login, true)}${COLUMNS.map(([key]) => td(r.status?.[key] ?? 0)).join('')}</tr>`;
    })
    .join('');
  const foot = `<tr>${td('Total', true, true)}${td('', true)}${COLUMNS.map(([key]) => td(totals[key], false, true)).join('')}</tr>`;
  const table = data.rows.length
    ? `<table style="border-collapse:collapse;font-size:13px;"><thead>${head}</thead><tbody>${body}${foot}</tbody></table>`
    : '<p>Nobody to show yet.</p>';

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
<h2 style="margin:0 0 4px 0;">Smart view - ${escapeHtml(data.companyName)}</h2>
<p style="margin:0 0 12px 0;color:#4b5563;">${escapeHtml(period)} &middot; as of ${escapeHtml(stampIst(data.sentAt))} (India time)</p>
<p style="margin:0 0 12px 0;">${escapeHtml(loggedLine)}${scopeLine ? '<br>' + escapeHtml(scopeLine) : ''}</p>
${table}
<p style="margin-top:16px;color:#6b7280;font-size:12px;">A day runs from 8:00 AM to 8:00 AM the next morning. Sent automatically every hour. Change who receives this under Report Emails.</p>
</body></html>`;

  // ------------------------------------------------------------ plain text
  const lines = [
    `Smart view - ${data.companyName}`,
    `${period} - as of ${stampIst(data.sentAt)} (India time)`,
    loggedLine,
  ];
  if (scopeLine) lines.push(scopeLine);
  lines.push('');
  if (data.rows.length) {
    for (const r of data.rows) {
      const login = r.attendance ? clockIst(r.attendance.first_login_at) : '-';
      lines.push(
        `${r.userDetails.username} (first login ${login}): ` +
          COLUMNS.map(([key, label]) => `${label} ${r.status?.[key] ?? 0}`).join(', '),
      );
    }
    lines.push('');
    lines.push('TOTAL: ' + COLUMNS.map(([key, label]) => `${label} ${totals[key]}`).join(', '));
  } else {
    lines.push('Nobody to show yet.');
  }
  lines.push('');
  lines.push('A day runs from 8:00 AM to 8:00 AM the next morning. Sent automatically every hour.');

  return { subject, html, text: lines.join('\n') };
}
