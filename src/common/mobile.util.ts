/**
 * Normalises a phone number to the 10 digits that identify a contact.
 *
 * Accepts the usual ways people type or export numbers: spaces, dashes,
 * brackets, "+91", "91", "0091" and a leading "0". Excel often hands numbers
 * over as real numbers rather than text, so non-string input is accepted too.
 *
 * Returns null when the value cannot be a 10 digit mobile number.
 */
export function normalizeMobile(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  let text = String(raw).trim();
  if (text === '') {
    return null;
  }

  // "9.87654321E9" style values are Excel number formatting damage, and
  // digits stripped out of them would silently be the wrong number.
  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(text)) {
    return null;
  }

  // A trailing ".0" appears when a numeric cell is read as a float.
  text = text.replace(/\.0+$/, '');

  let digits = text.replace(/\D/g, '');

  if (digits.length === 14 && digits.startsWith('0091')) {
    digits = digits.slice(4);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return /^\d{10}$/.test(digits) ? digits : null;
}
