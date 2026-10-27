import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Lead } from './lead.schema';
import { UpdateLeadDto } from './dto/update-lead.dto';
import {
  ContactsService,
  IngestSummary,
  RawLeadRow,
} from 'src/contacts/contacts.service';
import {
  deletePoolRows,
  getPoolRow,
  listPool,
  removePoolRow,
  updatePoolRow,
} from 'src/contacts/pool.helper';

/**
 * The company's pool of uploaded numbers waiting to be handed to staff.
 * Every row points at a contact; a number can wait here only once.
 */
@Injectable()
export class LeadsService {
  constructor(
    @InjectModel(Lead.name) private readonly model: Model<Lead>,
    private readonly contacts: ContactsService,
  ) {}

  /** Daily upload: paste box or Excel rows. */
  async ingest(
    ctx: { branch: string; uploadedBy?: string },
    rows: RawLeadRow[],
  ): Promise<IngestSummary> {
    return this.contacts.ingestIntoPool(this.model, ctx, rows);
  }

  async deleteByIds(ids: string[], branch?: string): Promise<any> {
    return deletePoolRows(this.model, ids, branch);
  }

  async findAll(params: Record<string, any>, branch?: string) {
    return listPool(this.model, params, branch);
  }

  async getById(id: string, branch?: string): Promise<Lead> {
    return getPoolRow(this.model, id, branch);
  }

  async findBy(query: Record<string, any>): Promise<Lead[]> {
    return this.model.find(query).exec();
  }

  async findByOne(query: Record<string, any>): Promise<Lead> {
    return this.model.findOne(query).exec();
  }

  async update(
    id: string,
    dto: UpdateLeadDto,
    branch?: string,
  ): Promise<Lead> {
    return updatePoolRow(this.model, this.contacts, id, dto, branch);
  }

  async remove(id: string, branch?: string): Promise<Lead> {
    return removePoolRow(this.model, id, branch);
  }
}
