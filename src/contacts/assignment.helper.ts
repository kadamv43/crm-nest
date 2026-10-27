import { Model, Types } from 'mongoose';
import { ContactsService, RawLeadRow } from './contacts.service';
import { LeadActivityService } from './lead-activity.service';
import { LeadActivitySource } from './lead-activity.schema';

export interface AssignContext {
  branch: string;
  /** who is handing the leads out (admin / team lead) */
  actorId: string;
  actorName?: string;
}

export interface AssignSummary {
  total_in_file: number;
  invalid: number;
  invalid_mobiles: string[];
  duplicates_in_file: number;
  new_contacts: number;
  existing_contacts: number;
  assigned: number;
  message: string;
  data: any[];
}

/**
 * Saves calling rows (UserLead / UserHotLead) for staff. Every row gets its
 * contact, so the same number assigned again later is another row on the
 * same contact. One ASSIGNED activity is written per row.
 */
export async function assignMany(
  model: Model<any>,
  contacts: ContactsService,
  activity: LeadActivityService,
  source: LeadActivitySource,
  ctx: AssignContext,
  items: Record<string, any>[],
): Promise<any[]> {
  if (items.length === 0) {
    return [];
  }
  const prepared = await contacts.attach<any>(
    ctx.branch,
    items.map((item) => ({ ...item, branch: new Types.ObjectId(ctx.branch) })),
  );
  const created = await model.insertMany(prepared);
  await activity.logAssigned(source, created, ctx.actorId);
  return created;
}

/**
 * Pasted numbers handed straight to one staff member. Repeats inside the
 * paste are removed; numbers already known keep their contact.
 */
export async function assignByMobiles(
  model: Model<any>,
  contacts: ContactsService,
  activity: LeadActivityService,
  source: LeadActivitySource,
  ctx: AssignContext,
  assigneeId: string,
  rows: RawLeadRow[],
): Promise<AssignSummary> {
  const resolved = await contacts.resolve(ctx.branch, rows);

  const items = resolved.rows.map((r) => ({
    contact: r.contact._id,
    mobile: r.mobile,
    name: r.row.name || r.contact.name,
    city: r.row.city || r.contact.city,
    user: assigneeId,
    assigned_by: ctx.actorName,
    branch: new Types.ObjectId(ctx.branch),
  }));

  const created = items.length ? await model.insertMany(items) : [];
  await activity.logAssigned(source, created, ctx.actorId);

  const parts = [
    `${created.length} assigned`,
    `${resolved.new_contacts} new contacts`,
    `${resolved.existing_contacts} already known`,
  ];
  if (resolved.duplicates_in_file)
    parts.push(`${resolved.duplicates_in_file} repeated in the list (removed)`);
  if (resolved.invalid.length)
    parts.push(`${resolved.invalid.length} invalid numbers (skipped)`);

  return {
    total_in_file: resolved.total_in_file,
    invalid: resolved.invalid.length,
    invalid_mobiles: resolved.invalid
      .slice(0, 10)
      .map((i) => String(i.row?.mobile ?? '')),
    duplicates_in_file: resolved.duplicates_in_file,
    new_contacts: resolved.new_contacts,
    existing_contacts: resolved.existing_contacts,
    assigned: created.length,
    message: parts.join(', '),
    data: created,
  };
}
