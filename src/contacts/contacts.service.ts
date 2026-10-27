import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contact, ContactDocument } from './contact.schema';
import { normalizeMobile } from 'src/common/mobile.util';

export interface RawLeadRow {
  mobile?: any;
  name?: any;
  city?: any;
  [key: string]: any;
}

export interface ResolvedRow {
  row: RawLeadRow;
  contact: ContactDocument;
  mobile: string;
  isNew: boolean;
}

export interface ResolveResult {
  rows: ResolvedRow[];
  invalid: { row: RawLeadRow; index: number }[];
  total_in_file: number;
  duplicates_in_file: number;
  new_contacts: number;
  existing_contacts: number;
}

export interface IngestSummary {
  total_in_file: number;
  invalid: number;
  invalid_mobiles: string[];
  duplicates_in_file: number;
  new_contacts: number;
  existing_contacts: number;
  already_in_pool: number;
  added: number;
  message: string;
}

const CHUNK = 1000;

const clean = (value: any): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text === '' ? undefined : text;
};

const isDuplicateKeyError = (err: any) =>
  err?.code === 11000 ||
  (Array.isArray(err?.writeErrors) &&
    err.writeErrors.length > 0 &&
    err.writeErrors.every((e: any) => (e.code ?? e.err?.code) === 11000));

@Injectable()
export class ContactsService {
  constructor(
    @InjectModel(Contact.name) private readonly model: Model<ContactDocument>,
  ) {}

  /**
   * Turns raw rows (from a paste or an Excel file) into contacts of one
   * company. A number that already has a contact reuses it; a new number
   * creates one. Invalid numbers and repeats inside the same file are left
   * out and counted.
   */
  async resolve(
    branch: string | Types.ObjectId,
    rows: RawLeadRow[],
  ): Promise<ResolveResult> {
    const branchId = new Types.ObjectId(String(branch));

    const unique = new Map<string, RawLeadRow>();
    const invalid: { row: RawLeadRow; index: number }[] = [];
    let duplicates = 0;

    rows.forEach((row, index) => {
      const mobile = normalizeMobile(row?.mobile);
      if (!mobile) {
        invalid.push({ row, index });
      } else if (unique.has(mobile)) {
        duplicates++;
      } else {
        unique.set(mobile, row);
      }
    });

    const mobiles = [...unique.keys()];
    const existingSet = new Set<string>();

    for (let i = 0; i < mobiles.length; i += CHUNK) {
      const found = await this.model
        .find({ branch: branchId, mobile: { $in: mobiles.slice(i, i + CHUNK) } })
        .select('mobile')
        .lean();
      found.forEach((c: any) => existingSet.add(c.mobile));
    }

    const missing = mobiles.filter((m) => !existingSet.has(m));
    for (let i = 0; i < missing.length; i += CHUNK) {
      await this.createMissing(branchId, missing.slice(i, i + CHUNK), unique);
    }

    const byMobile = new Map<string, ContactDocument>();
    for (let i = 0; i < mobiles.length; i += CHUNK) {
      const all = await this.model.find({
        branch: branchId,
        mobile: { $in: mobiles.slice(i, i + CHUNK) },
      });
      all.forEach((c) => byMobile.set(c.mobile, c));
    }

    const resolved: ResolvedRow[] = mobiles.map((mobile) => ({
      row: unique.get(mobile),
      contact: byMobile.get(mobile),
      mobile,
      isNew: !existingSet.has(mobile),
    }));

    return {
      rows: resolved,
      invalid,
      total_in_file: rows.length,
      duplicates_in_file: duplicates,
      new_contacts: missing.length,
      existing_contacts: mobiles.length - missing.length,
    };
  }

  // Upsert so two people uploading the same new number at the same moment
  // still end up with one contact. A lost race shows up as a duplicate-key
  // error; running the (idempotent) upsert once more settles it.
  private async createMissing(
    branchId: Types.ObjectId,
    mobiles: string[],
    source: Map<string, RawLeadRow>,
  ) {
    const now = new Date();
    const ops = mobiles.map((mobile) => {
      const row = source.get(mobile);
      const insert: Record<string, any> = { created_at: now, updated_at: now };
      const name = clean(row?.name);
      const city = clean(row?.city);
      if (name) insert.name = name;
      if (city) insert.city = city;
      return {
        updateOne: {
          filter: { branch: branchId, mobile },
          update: { $setOnInsert: insert },
          upsert: true,
        },
      };
    });

    try {
      await this.model.bulkWrite(ops as any, { ordered: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) {
        throw err;
      }
      await this.model.bulkWrite(ops as any, { ordered: false });
    }
  }

  /**
   * Adds uploaded numbers to a company's pool (Lead or HotLead). Every row
   * points at its contact. A number already waiting in the pool is skipped so
   * it is not handed out twice.
   */
  async ingestIntoPool(
    poolModel: Model<any>,
    ctx: { branch: string; uploadedBy?: string },
    rows: RawLeadRow[],
  ): Promise<IngestSummary> {
    const resolved = await this.resolve(ctx.branch, rows);
    const branchId = new Types.ObjectId(ctx.branch);

    const contactIds = resolved.rows.map((r) => r.contact._id);
    const waiting = new Set<string>();
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const found = await poolModel
        .find({ branch: branchId, contact: { $in: contactIds.slice(i, i + CHUNK) } })
        .select('contact')
        .lean();
      found.forEach((w: any) => waiting.add(String(w.contact)));
    }

    const now = new Date();
    const toAdd = resolved.rows
      .filter((r) => !waiting.has(String(r.contact._id)))
      .map((r) => {
        const doc: Record<string, any> = {
          contact: r.contact._id,
          mobile: r.mobile,
          branch: branchId,
          name: clean(r.row.name) ?? r.contact.name,
          city: clean(r.row.city) ?? r.contact.city,
          created_at: now,
          updated_at: now,
        };
        if (ctx.uploadedBy) {
          doc.uploaded_by = new Types.ObjectId(ctx.uploadedBy);
        }
        const investment = clean(r.row.investment);
        if (investment) {
          doc.investment = investment;
        }
        return doc;
      });

    let added = 0;
    if (toAdd.length > 0) {
      try {
        const inserted = await poolModel.insertMany(toAdd, { ordered: false });
        added = inserted.length;
      } catch (err: any) {
        if (!isDuplicateKeyError(err)) {
          throw err;
        }
        // another upload put the same numbers in the pool a moment ago
        added =
          err?.result?.insertedCount ??
          err?.insertedDocs?.length ??
          err?.result?.result?.nInserted ??
          0;
      }
    }

    const alreadyInPool = resolved.rows.length - added;
    const summary: IngestSummary = {
      total_in_file: resolved.total_in_file,
      invalid: resolved.invalid.length,
      invalid_mobiles: resolved.invalid
        .slice(0, 10)
        .map((i) => String(i.row?.mobile ?? '')),
      duplicates_in_file: resolved.duplicates_in_file,
      new_contacts: resolved.new_contacts,
      existing_contacts: resolved.existing_contacts,
      already_in_pool: alreadyInPool,
      added,
      message: '',
    };
    summary.message = describeIngest(summary);
    return summary;
  }

  /**
   * For rows that are about to be handed to a staff member: gives every row
   * its contact. Rows that already carry a contact of this company keep it;
   * the rest are resolved from their mobile. An unusable mobile is an error,
   * because an explicit assignment must not silently drop a lead.
   */
  async attach<T extends { mobile?: any; contact?: any }>(
    branch: string | Types.ObjectId,
    items: T[],
  ): Promise<(T & { contact: Types.ObjectId; mobile: string })[]> {
    const branchId = new Types.ObjectId(String(branch));

    const wantedIds = items
      .map((i) => i.contact)
      .filter((id) => id && Types.ObjectId.isValid(String(id)))
      .map((id) => new Types.ObjectId(String(id)));

    const known = new Map<string, ContactDocument>();
    if (wantedIds.length > 0) {
      const found = await this.model.find({
        _id: { $in: wantedIds },
        branch: branchId,
      });
      found.forEach((c) => known.set(String(c._id), c));
    }

    const needResolve = items.filter(
      (i) => !(i.contact && known.has(String(i.contact))),
    );
    const resolved = needResolve.length
      ? await this.resolve(branchId, needResolve)
      : null;

    if (resolved && resolved.invalid.length > 0) {
      const bad = resolved.invalid
        .slice(0, 5)
        .map((i) => String(i.row?.mobile ?? '(empty)'))
        .join(', ');
      throw new BadRequestException(`Invalid mobile number: ${bad}`);
    }

    const byMobile = new Map<string, ContactDocument>();
    resolved?.rows.forEach((r) => byMobile.set(r.mobile, r.contact));

    return items.map((item) => {
      const existing = item.contact ? known.get(String(item.contact)) : null;
      const contact = existing ?? byMobile.get(normalizeMobile(item.mobile));
      return { ...item, contact: contact._id, mobile: contact.mobile };
    });
  }

  /** Contact of one number in one company (null when never seen). */
  async findByMobile(branch: string | undefined, mobile: string) {
    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      throw new BadRequestException('Invalid Mobile Number');
    }
    const filter: Record<string, any> = { mobile: normalized };
    if (branch) {
      filter.branch = new Types.ObjectId(branch);
    }
    return this.model.find(filter).exec();
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.model.findById(id).exec();
  }

  /** Number of unique leads (contacts), optionally for one company. */
  async countUnique(branch?: string) {
    const filter = branch ? { branch: new Types.ObjectId(branch) } : {};
    return this.model.countDocuments(filter).exec();
  }

  /** Unique leads per company, with the company name. */
  async countUniqueByBranch() {
    return this.model.aggregate([
      { $group: { _id: '$branch', total: { $sum: 1 } } },
      {
        $lookup: {
          from: 'branches',
          localField: '_id',
          foreignField: '_id',
          as: 'branch',
        },
      },
      { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          branch: '$_id',
          name: '$branch.name',
          total: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);
  }
}

export function describeIngest(s: Omit<IngestSummary, 'message'> | IngestSummary) {
  const parts = [
    `${s.added} added`,
    `${s.new_contacts} new contacts`,
    `${s.existing_contacts} already known`,
  ];
  if (s.already_in_pool) parts.push(`${s.already_in_pool} already waiting in the pool (skipped)`);
  if (s.duplicates_in_file) parts.push(`${s.duplicates_in_file} repeated in the file (removed)`);
  if (s.invalid) parts.push(`${s.invalid} invalid numbers (skipped)`);
  return parts.join(', ');
}
