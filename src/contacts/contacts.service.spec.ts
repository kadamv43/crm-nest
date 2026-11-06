import mongoose, { Model, Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { Contact, ContactSchema } from './contact.schema';
import { ContactsService } from './contacts.service';

// Runs against a throwaway MongoDB. Set TEST_MONGO_URI, e.g.
// mongodb://127.0.0.1:27099/crm_contacts_test; skipped otherwise.
const uri = process.env.TEST_MONGO_URI;
const describeDb = uri ? describe : describe.skip;

describeDb('ContactsService', () => {
  let conn: mongoose.Connection;
  let model: Model<Contact>;
  let service: ContactsService;

  const branchA = new Types.ObjectId();
  const branchB = new Types.ObjectId();

  beforeAll(async () => {
    conn = await mongoose.createConnection(uri).asPromise();
    model = conn.model<Contact>('Contact', ContactSchema);
    await model.init(); // build the unique index before any test relies on it
    service = new ContactsService(model as any);
  });

  afterAll(async () => {
    await conn.dropDatabase();
    await conn.close();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  describe('resolve', () => {
    it('creates one contact per new number and reports them as new', async () => {
      const r = await service.resolve(branchA, [
        { mobile: '9000000001', name: 'Asha', city: 'Pune' },
        { mobile: '9000000002' },
      ]);
      expect(r.new_contacts).toBe(2);
      expect(r.existing_contacts).toBe(0);
      expect(r.rows.every((x) => x.isNew)).toBe(true);
      expect(await model.countDocuments({ branch: branchA })).toBe(2);

      const asha = await model.findOne({ mobile: '9000000001' });
      expect(asha.name).toBe('Asha');
      expect(asha.city).toBe('Pune');
    });

    it('reuses the existing contact when the number is uploaded again', async () => {
      const first = await service.resolve(branchA, [{ mobile: '9000000001' }]);
      const second = await service.resolve(branchA, [{ mobile: '9000000001' }]);

      expect(second.new_contacts).toBe(0);
      expect(second.existing_contacts).toBe(1);
      expect(String(second.rows[0].contact._id)).toBe(
        String(first.rows[0].contact._id),
      );
      expect(await model.countDocuments({})).toBe(1);
    });

    it('treats differently typed versions of a number as the same contact', async () => {
      const r = await service.resolve(branchA, [
        { mobile: '9000000001' },
        { mobile: '+91 90000 00001' },
        { mobile: '09000000001' },
        { mobile: 9000000001 },
      ]);
      expect(r.rows.length).toBe(1);
      expect(r.duplicates_in_file).toBe(3);
      expect(await model.countDocuments({})).toBe(1);
    });

    it('removes repeats inside one file and keeps the first row details', async () => {
      const r = await service.resolve(branchA, [
        { mobile: '9000000001', name: 'First' },
        { mobile: '9000000002' },
        { mobile: '9000000001', name: 'Second' },
      ]);
      expect(r.total_in_file).toBe(3);
      expect(r.duplicates_in_file).toBe(1);
      expect(r.rows.length).toBe(2);
      const c = await model.findOne({ mobile: '9000000001' });
      expect(c.name).toBe('First');
    });

    it('skips invalid and blank numbers and counts them', async () => {
      const r = await service.resolve(branchA, [
        { mobile: '9000000001' },
        { mobile: 'abc' },
        { mobile: '' },
        { mobile: '123' },
        {},
      ]);
      expect(r.rows.length).toBe(1);
      expect(r.invalid.length).toBe(4);
      expect(await model.countDocuments({})).toBe(1);
    });

    it('keeps companies separate: the same number is a contact in each', async () => {
      await service.resolve(branchA, [{ mobile: '9000000001' }]);
      const b = await service.resolve(branchB, [{ mobile: '9000000001' }]);

      expect(b.new_contacts).toBe(1);
      expect(await model.countDocuments({})).toBe(2);
      expect(await service.countUnique(String(branchA))).toBe(1);
      expect(await service.countUnique(String(branchB))).toBe(1);
      expect(await service.countUnique()).toBe(2);
    });

    it('does not overwrite an existing contact with a later upload', async () => {
      await service.resolve(branchA, [{ mobile: '9000000001', name: 'Old' }]);
      await service.resolve(branchA, [{ mobile: '9000000001', name: 'New' }]);
      expect((await model.findOne({ mobile: '9000000001' })).name).toBe('Old');
    });

    it('handles an empty upload', async () => {
      const r = await service.resolve(branchA, []);
      expect(r.rows).toEqual([]);
      expect(r.total_in_file).toBe(0);
    });

    it('two uploads of the same new numbers at the same time still make one contact each', async () => {
      const rows = Array.from({ length: 200 }, (_, i) => ({
        mobile: String(9100000000 + i),
      }));
      const results = await Promise.all([
        service.resolve(branchA, rows),
        service.resolve(branchA, rows),
        service.resolve(branchA, rows),
        service.resolve(branchA, rows),
      ]);
      expect(await model.countDocuments({ branch: branchA })).toBe(200);
      results.forEach((r) => expect(r.rows.length).toBe(200));
      // every upload sees the same contact for the same number
      const ids = results.map((r) => r.rows.map((x) => String(x.contact._id)));
      ids.forEach((list) => expect(list).toEqual(ids[0]));
    });

    it('handles a large upload in chunks', async () => {
      const rows = Array.from({ length: 2500 }, (_, i) => ({
        mobile: String(9200000000 + i),
      }));
      const r = await service.resolve(branchA, rows);
      expect(r.new_contacts).toBe(2500);
      const again = await service.resolve(branchA, rows);
      expect(again.new_contacts).toBe(0);
      expect(again.existing_contacts).toBe(2500);
      expect(await model.countDocuments({ branch: branchA })).toBe(2500);
    }, 60000);
  });

  describe('unique index', () => {
    it('refuses a second contact for the same company and number', async () => {
      await model.create({ branch: branchA, mobile: '9000000001' });
      await expect(
        model.create({ branch: branchA, mobile: '9000000001' }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('attach', () => {
    it('keeps a contact the row already has', async () => {
      const r = await service.resolve(branchA, [{ mobile: '9000000001' }]);
      const contact = r.rows[0].contact;
      const [item] = await service.attach(branchA, [
        { contact: String(contact._id), mobile: 'whatever', extra: 1 } as any,
      ]);
      expect(String(item.contact)).toBe(String(contact._id));
      expect(item.mobile).toBe('9000000001');
      expect((item as any).extra).toBe(1);
      expect(await model.countDocuments({})).toBe(1);
    });

    it('creates or finds the contact from the mobile when the row has none', async () => {
      await service.resolve(branchA, [{ mobile: '9000000001' }]);
      const items = await service.attach(branchA, [
        { mobile: '+91 9000000001' },
        { mobile: '9000000002' },
        { mobile: '9000000002' }, // assigning twice is allowed, nothing is dropped
      ]);
      expect(items.length).toBe(3);
      expect(String(items[1].contact)).toBe(String(items[2].contact));
      expect(await model.countDocuments({})).toBe(2);
    });

    it('ignores a contact id from another company and resolves by mobile instead', async () => {
      const other = await service.resolve(branchB, [{ mobile: '9000000001' }]);
      const [item] = await service.attach(branchA, [
        { contact: String(other.rows[0].contact._id), mobile: '9000000001' },
      ]);
      expect(String(item.contact)).not.toBe(String(other.rows[0].contact._id));
      expect(await model.countDocuments({ branch: branchA })).toBe(1);
    });

    it('rejects an invalid mobile instead of silently dropping the lead', async () => {
      await expect(
        service.attach(branchA, [{ mobile: '9000000001' }, { mobile: 'abc' }]),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.attach(branchA, [{ mobile: 'abc' }]),
      ).rejects.toThrow(/Invalid mobile number: abc/);
    });
  });

  describe('counts and lookup', () => {
    it('counts unique leads per company', async () => {
      await service.resolve(branchA, [
        { mobile: '9000000001' },
        { mobile: '9000000002' },
      ]);
      await service.resolve(branchA, [{ mobile: '9000000001' }]); // repeat
      await service.resolve(branchB, [{ mobile: '9000000001' }]);

      expect(await service.countUnique(String(branchA))).toBe(2);
      const by = await service.countUniqueByBranch();
      expect(by.find((b) => String(b.branch) === String(branchA)).total).toBe(2);
      expect(by.find((b) => String(b.branch) === String(branchB)).total).toBe(1);
    });

    it('finds a contact by any spelling of the number, only inside one company', async () => {
      await service.resolve(branchA, [{ mobile: '9000000001' }]);
      await service.resolve(branchB, [{ mobile: '9000000001' }]);

      expect((await service.findByMobile(String(branchA), '+91 9000000001')).length).toBe(1);
      expect((await service.findByMobile(undefined, '9000000001')).length).toBe(2);
      expect((await service.findByMobile(String(branchA), '9999999999')).length).toBe(0);
      await expect(service.findByMobile(String(branchA), 'abc')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
