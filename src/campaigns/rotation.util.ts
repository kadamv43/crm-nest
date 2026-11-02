// Statuses after which a lead is finished and stops rotating.
export const FINAL_STATUSES = ['PAYMENT_DONE', 'NOT_INTERESTED', 'DEAD'];

// Every status a campaign lead can be in, FRESH being "not called yet".
export const CAMPAIGN_STATUSES = [
  'FRESH',
  'CALLBACK',
  'FREE_TRIAL',
  'RINGING',
  'SWITCHED_OFF',
  'DEAD',
  'NOT_REACHABLE',
  'NOT_INTERESTED',
  'EXPECTED_PAYMENT',
  'PAYMENT_DONE',
];

// What moves to the next round when the admin makes no choice: everything
// except the finished statuses.
export const DEFAULT_MOVE_STATUSES = CAMPAIGN_STATUSES.filter(
  (s) => !FINAL_STATUSES.includes(s),
);

export const MAX_CAMPAIGN_LEADS = 10000;
export const MAX_CAMPAIGN_STAFF = 50;

/** Batch of the n-th lead (0-based): batches differ in size by at most one. */
export const batchOf = (index: number, staffCount: number) => index % staffCount;

/** Who holds a batch in a round (round 1 = first hand-out). */
export const holderIndex = (batch: number, round: number, staffCount: number) =>
  (batch + round - 1) % staffCount;
