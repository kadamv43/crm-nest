// Statuses after which a lead is finished and stops rotating.
export const FINAL_STATUSES = ['PAYMENT_DONE', 'NOT_INTERESTED', 'DEAD'];

export const MAX_CAMPAIGN_LEADS = 10000;
export const MAX_CAMPAIGN_STAFF = 50;

/** Batch of the n-th lead (0-based): batches differ in size by at most one. */
export const batchOf = (index: number, staffCount: number) => index % staffCount;

/** Who holds a batch in a round (round 1 = first hand-out). */
export const holderIndex = (batch: number, round: number, staffCount: number) =>
  (batch + round - 1) % staffCount;
