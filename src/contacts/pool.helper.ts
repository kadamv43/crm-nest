import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { normalizeMobile } from 'src/common/mobile.util';
import { parseDayRange } from 'src/common/time.util';
import { ContactsService } from './contacts.service';

export const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const scope = (branch?: string) =>
  branch ? { branch: new Types.ObjectId(branch) } : {};

/** Page of a company's pool (Lead / HotLead), newest first. */
export async function listPool(
  model: Model<any>,
  params: Record<string, any>,
  branch?: string,
) {
  const size = parseInt(params.size, 10) || 0; // 0 = no limit, as before
  const page = parseInt(params.page, 10) || 0;

  const query: Record<string, any> = { ...scope(branch) };
  if (params.q) {
    const regex = new RegExp(escapeRegex(String(params.q)), 'i');
    query.$or = [{ mobile: regex }, { name: regex }, { city: regex }];
  }

  // the date range is the day the number was uploaded (India-time days)
  const range = parseDayRange(params.from, params.to);
  if (range) {
    query.created_at = { $gte: range.gte, $lte: range.lte };
  }

  const [data, total] = await Promise.all([
    model
      .find(query)
      .sort({ created_at: -1 })
      .skip(page * size)
      .limit(size)
      .exec(),
    model.countDocuments(query).exec(),
  ]);
  return { data, total };
}

export async function getPoolRow(
  model: Model<any>,
  id: string,
  branch?: string,
) {
  const row = await model.findOne({ _id: id, ...scope(branch) }).exec();
  if (!row) {
    throw new NotFoundException(`Lead #${id} not found`);
  }
  return row;
}

export async function removePoolRow(
  model: Model<any>,
  id: string,
  branch?: string,
) {
  const row = await model
    .findOneAndDelete({ _id: id, ...scope(branch) })
    .exec();
  if (!row) {
    throw new NotFoundException(`Lead #${id} not found`);
  }
  return row;
}

export async function deletePoolRows(
  model: Model<any>,
  ids: string[],
  branch?: string,
): Promise<{ deletedCount: number }> {
  const objectIds = ids
    .filter((id) => id && Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  return model.deleteMany({ _id: { $in: objectIds }, ...scope(branch) });
}

/**
 * Edits a pool row. The number is the contact's identity, so changing it
 * points the row at the (found or created) contact of the new number instead
 * of editing text in place; the company and contact cannot be set directly.
 */
export async function updatePoolRow(
  model: Model<any>,
  contacts: ContactsService,
  id: string,
  dto: Record<string, any>,
  branch?: string,
) {
  const row = await getPoolRow(model, id, branch);

  const { mobile, contact: _c, branch: _b, _id: _i, ...changes } = dto ?? {};
  const update: Record<string, any> = { ...changes, updated_at: new Date() };

  if (mobile !== undefined && mobile !== null && String(mobile).trim() !== '') {
    const normalized = normalizeMobile(mobile);
    if (!normalized) {
      throw new BadRequestException('Invalid Mobile Number');
    }
    if (normalized !== row.mobile) {
      const resolved = await contacts.resolve(row.branch, [
        {
          mobile: normalized,
          name: changes.name ?? row.name,
          city: changes.city ?? row.city,
        },
      ]);
      const contact = resolved.rows[0].contact;
      const clash = await model.exists({
        branch: row.branch,
        contact: contact._id,
        _id: { $ne: row._id },
      });
      if (clash) {
        throw new ConflictException(
          'This number is already waiting in the pool',
        );
      }
      update.contact = contact._id;
      update.mobile = contact.mobile;
    }
  }

  return model
    .findByIdAndUpdate(row._id, { $set: update }, { new: true })
    .exec();
}
