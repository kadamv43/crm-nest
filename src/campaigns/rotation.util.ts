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

export interface PlanLead {
  /** any unique id of the lead (its contact) */
  key: string;
  /** the batch it started in; decides who is "next in line" when the staff stay the same */
  batch: number;
  /** everybody who has already held this lead in the campaign */
  held: Set<string>;
}

export interface RoundPlan {
  /** lead key -> staff id */
  assign: Map<string, string>;
  /** leads that nobody chosen can take, because all of them already had it */
  unplaced: string[];
}

/**
 * Decides who takes each moving lead in a round.
 *
 *  - never someone who already held the lead;
 *  - the person next in line (batch + round - 1, as in a plain rotation) when
 *    they are free, so unchanged staff give the same circle as before;
 *  - otherwise whoever has the fewest leads this round, so the load is level;
 *  - leads with the fewest possible takers are placed first, so a lead that can
 *    only go to one person is never crowded out.
 */
export function planRound(leads: PlanLead[], staff: string[], round: number): RoundPlan {
  const assign = new Map<string, string>();
  const unplaced: string[] = [];
  const count = staff.length;
  if (count === 0) return { assign, unplaced: leads.map((l) => l.key) };

  const load = new Map<string, number>(staff.map((s) => [s, 0]));
  const cap = Math.ceil(leads.length / count);
  const takers = (lead: PlanLead) => staff.filter((s) => !lead.held.has(s));

  const ordered = leads
    .map((lead) => ({ lead, takers: takers(lead) }))
    .sort(
      (a, b) =>
        a.takers.length - b.takers.length ||
        a.lead.batch - b.lead.batch ||
        (a.lead.key < b.lead.key ? -1 : 1),
    );

  const place = (lead: PlanLead, who: string) => {
    assign.set(lead.key, who);
    load.set(who, (load.get(who) ?? 0) + 1);
  };
  const leastLoaded = (options: string[]) =>
    options.reduce((best, s) => ((load.get(s) ?? 0) < (load.get(best) ?? 0) ? s : best));

  const deferred: { lead: PlanLead; takers: string[] }[] = [];
  for (const entry of ordered) {
    if (entry.takers.length === 0) {
      unplaced.push(entry.lead.key);
      continue;
    }
    const preferred = staff[(entry.lead.batch + round - 1) % count];
    if (entry.takers.includes(preferred) && (load.get(preferred) ?? 0) < cap) {
      place(entry.lead, preferred);
      continue;
    }
    const roomy = entry.takers.filter((s) => (load.get(s) ?? 0) < cap);
    if (roomy.length) place(entry.lead, leastLoaded(roomy));
    else deferred.push(entry);
  }
  // someone is "full" only to keep things level; a lead that can go nowhere else still goes
  for (const entry of deferred) place(entry.lead, leastLoaded(entry.takers));

  // Level the load. If someone has two or more leads than someone else, move a
  // lead from the busier to the quieter person -- possibly through a chain of
  // people (A gives to B, B gives to C) when no direct hand-over is allowed.
  const takerSets = new Map<string, Set<string>>(
    ordered.map((e) => [e.lead.key, new Set(e.takers)]),
  );
  const leadsOf = new Map<string, string[]>(staff.map((s) => [s, []]));
  assign.forEach((who, key) => leadsOf.get(who)!.push(key));
  const sizeOf = (s: string) => leadsOf.get(s)!.length;

  for (let guard = leads.length * 2 + 10; guard > 0; guard--) {
    const lightest = Math.min(...staff.map(sizeOf));
    const busy = staff
      .filter((s) => sizeOf(s) >= lightest + 2)
      .sort((a, b) => sizeOf(b) - sizeOf(a));
    let shifted = false;
    for (const src of busy) {
      const prev = new Map<string, { from: string; key: string }>();
      const seen = new Set<string>([src]);
      const queue = [src];
      let target: string | null = null;
      while (queue.length && !target) {
        const u = queue.shift()!;
        for (const v of staff) {
          if (seen.has(v)) continue;
          const key = leadsOf.get(u)!.find((k) => takerSets.get(k)!.has(v));
          if (key === undefined) continue;
          seen.add(v);
          prev.set(v, { from: u, key });
          if (sizeOf(v) <= sizeOf(src) - 2) {
            target = v;
            break;
          }
          queue.push(v);
        }
      }
      if (target) {
        for (let cur = target; cur !== src; ) {
          const { from, key } = prev.get(cur)!;
          const list = leadsOf.get(from)!;
          list.splice(list.indexOf(key), 1);
          leadsOf.get(cur)!.push(key);
          assign.set(key, cur);
          cur = from;
        }
        shifted = true;
        break;
      }
    }
    if (!shifted) break;
  }

  return { assign, unplaced };
}
