import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

/**
 * Reads the first sheet of an uploaded workbook as plain rows.
 * Column headers are lower-cased and trimmed so "Mobile", " mobile " and
 * "MOBILE" all work.
 */
export function readSheetRows(file: Express.Multer.File): Record<string, any>[] {
  if (!file?.buffer) {
    throw new BadRequestException('File is required');
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file.buffer, { type: 'buffer' });
  } catch {
    throw new BadRequestException('The file could not be read as an Excel file');
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new BadRequestException('The Excel file has no sheets');
  }

  // A file that is not really a spreadsheet can still be "read" as one line
  // of text. Insist on a header row with a mobile column so that mistake is
  // reported instead of looking like an upload of zero leads.
  const header = (XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 })[0] ?? [])
    .map((cell) => String(cell).trim().toLowerCase());
  if (!header.includes('mobile')) {
    throw new BadRequestException(
      'The first row of the Excel file must have a column named "mobile"',
    );
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: '',
    raw: true,
  });

  return rows.map((row) => {
    const clean: Record<string, any> = {};
    for (const key of Object.keys(row)) {
      clean[key.trim().toLowerCase()] = row[key];
    }
    return clean;
  });
}

/** Splits pasted text (one number per line) into rows. */
export function rowsFromPastedText(text: unknown): { mobile: string }[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((mobile) => ({ mobile }));
}
