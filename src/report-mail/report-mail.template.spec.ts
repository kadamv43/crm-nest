import {
  clockIst,
  escapeHtml,
  renderSmartViewMail,
  stampIst,
  totalsOf,
} from './report-mail.template';

// India time written the way people say it.
const ist = (text: string) => new Date(text.replace(' ', 'T') + ':00+05:30');

const status = (over: Record<string, number> = {}) => ({
  carried_forward: 0, assigned: 0, fresh: 0, total: 0, total_dialed: 0, callback: 0,
  free_trial: 0, ringing: 0, switched_off: 0, dead: 0, not_reachable: 0,
  not_interested: 0, expected_payment: 0, payment_done: 0, ...over,
});

const asha = {
  userDetails: { username: 'asha' },
  status: status({ carried_forward: 4, assigned: 10, fresh: 4, total: 10, total_dialed: 6, callback: 2, ringing: 1, payment_done: 2, dead: 1 }),
  attendance: { first_login_at: ist('2025-03-10 08:05') },
};
const ravi = {
  userDetails: { username: 'ravi' },
  status: status({ assigned: 3, fresh: 3, total: 3 }),
  attendance: null,
};

const data = (over: any = {}) => ({
  companyName: 'Company A',
  sentAt: ist('2025-03-10 14:00'),
  range: { from: '2025-03-10', to: '2025-03-10' },
  rows: [asha, ravi],
  loggedIn: { count: 1, total: 2 },
  onlyLoggedIn: false,
  ...over,
});

describe('clock formatting (India time)', () => {
  it.each([
    ['2025-03-10 00:05', '12:05 AM'],
    ['2025-03-10 08:05', '8:05 AM'],
    ['2025-03-10 11:59', '11:59 AM'],
    ['2025-03-10 12:00', '12:00 PM'],
    ['2025-03-10 14:00', '2:00 PM'],
    ['2025-03-10 23:59', '11:59 PM'],
  ])('%s is %s', (when, expected) => {
    expect(clockIst(ist(when))).toBe(expected);
  });

  it('is India time whatever the server clock says', () => {
    expect(clockIst(new Date('2025-03-10T02:35:00Z'))).toBe('8:05 AM');
    expect(clockIst('2025-03-10T02:35:00Z')).toBe('8:05 AM');
  });

  it('stamps with the day and month, across a month end', () => {
    expect(stampIst(ist('2025-10-30 14:00'))).toBe('30 Oct, 2:00 PM');
    expect(stampIst(ist('2025-03-01 00:30'))).toBe('1 Mar, 12:30 AM');
    // 6:30 PM UTC on the 31st is already 12:00 AM on the 1st in India
    expect(stampIst(new Date('2025-01-31T18:30:00Z'))).toBe('1 Feb, 12:00 AM');
  });
});

describe('escapeHtml', () => {
  it('neutralises markup', () => {
    expect(escapeHtml('<script>alert("x")</script> & \'y\'')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(5)).toBe('5');
  });
});

describe('totalsOf', () => {
  it('adds every column over the rows', () => {
    const t = totalsOf([asha, ravi] as any);
    expect(t).toMatchObject({ carried_forward: 4, assigned: 13, fresh: 7, total: 13, total_dialed: 6, callback: 2, ringing: 1, payment_done: 2, dead: 1 });
  });

  it('is all zeros for nobody', () => {
    expect(Object.values(totalsOf([])).every((v) => v === 0)).toBe(true);
  });
});

describe('renderSmartViewMail', () => {
  it('subject names the company and the hour', () => {
    expect(renderSmartViewMail(data()).subject).toBe('Smart view - Company A - 10 Mar, 2:00 PM');
  });

  it('html shows the company, the period, the time and who logged in', () => {
    const { html } = renderSmartViewMail(data());
    expect(html).toContain('Smart view - Company A');
    expect(html).toContain('10/03/2025');
    expect(html).toContain('as of 10 Mar, 2:00 PM (India time)');
    expect(html).toContain('Logged in today: 1 of 2 staff');
    expect(html).toContain('8:00 AM to 8:00 AM');
  });

  it('html has every column heading, a row per person and a totals row', () => {
    const { html } = renderSmartViewMail(data());
    for (const heading of ['Username', 'First login', 'Carried forward', 'Assigned', 'Fresh', 'Total', 'Dialed', 'Callback', 'Free trial', 'Ringing', 'Switch off', 'Dead', 'Not reachable', 'Not interested', 'Expected payment', 'Payment done']) {
      expect(html).toContain('>' + heading + '</th>');
    }
    expect(html.match(/<tr>/g).length).toBe(1 + 2 + 1); // header, two people, totals
    expect(html).toContain('>asha</td>');
    expect(html).toContain('>8:05 AM</td>'); // first login in India time
    expect(html).toContain('>ravi</td>');
    expect(html).toContain('>-</td>'); // ravi has not logged in
    expect(html).toContain('font-weight:bold;">13</td>'); // total of Assigned
  });

  it('numbers sit under the right headings (column order is fixed)', () => {
    const { html } = renderSmartViewMail(data({ rows: [asha] }));
    const row = html.split('<tbody>')[1].split('</tr>')[0];
    const cells = [...row.matchAll(/>([^<]*)<\/td>/g)].map((m) => m[1]);
    // username, first login, carried, assigned, fresh, total, dialed, callback, free trial, ringing, switch off, dead, not reachable, not interested, expected, payment
    expect(cells).toEqual(['asha', '8:05 AM', '4', '10', '4', '10', '6', '2', '0', '1', '0', '1', '0', '0', '0', '2']);
  });

  it('a date range is shown as a range', () => {
    const { html, text } = renderSmartViewMail(data({ range: { from: '2025-03-10', to: '2025-03-12' } }));
    expect(html).toContain('10/03/2025 to 12/03/2025');
    expect(text).toContain('10/03/2025 to 12/03/2025');
  });

  it('names and company are escaped, so nobody can inject markup into the mail', () => {
    const evil = { ...asha, userDetails: { username: '<img src=x onerror=alert(1)>' } };
    const { html, subject } = renderSmartViewMail(data({ companyName: 'A & <b>B</b>', rows: [evil] }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>B</b>');
    expect(html).toContain('A &amp; &lt;b&gt;B&lt;/b&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(subject).toContain('A & <b>B</b>'); // a subject is plain text
  });

  it('with nobody to show it says so instead of an empty table', () => {
    const { html, text } = renderSmartViewMail(data({ rows: [], loggedIn: { count: 0, total: 5 } }));
    expect(html).toContain('Nobody to show yet.');
    expect(html).not.toContain('<table');
    expect(text).toContain('Nobody to show yet.');
    expect(html).toContain('Logged in today: 0 of 5 staff');
  });

  it('tells readers when it only lists people who logged in', () => {
    expect(renderSmartViewMail(data({ onlyLoggedIn: true })).html).toContain('Showing only people who logged in.');
    expect(renderSmartViewMail(data({ onlyLoggedIn: false })).html).not.toContain('Showing only people who logged in.');
  });

  it('the plain-text copy has the same information', () => {
    const { text } = renderSmartViewMail(data());
    expect(text).toContain('Smart view - Company A');
    expect(text).toContain('Logged in today: 1 of 2 staff');
    expect(text).toContain('asha (first login 8:05 AM): Carried forward 4, Assigned 10, Fresh 4, Total 10, Dialed 6, Callback 2');
    expect(text).toContain('ravi (first login -)');
    expect(text).toContain('TOTAL: Carried forward 4, Assigned 13, Fresh 7');
    expect(text).not.toContain('<');
  });
});
