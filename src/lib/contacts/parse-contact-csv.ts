/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

/** Strip all non-digits then check it has a country code (7-15 digits, no leading zero). */
function sanitizeAndValidate(raw: string): { phone: string; valid: boolean; reason?: string } {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { phone: raw, valid: false, reason: 'empty' };
  if (digits.startsWith('0')) return { phone: digits, valid: false, reason: 'leading_zero' };
  if (digits.length < 7)   return { phone: digits, valid: false, reason: 'too_short' };
  if (digits.length > 15)  return { phone: digits, valid: false, reason: 'too_long' };
  if (digits.length < 10)  return { phone: digits, valid: false, reason: 'missing_country_code' };
  return { phone: digits, valid: true };
}

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
  /** Set when the phone number failed E.164 validation. */
  invalidPhone?: string; // human-readable reason
  /** Row index in the original CSV (1-based, excluding header). */
  rowIndex: number;
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
  /** Rows that failed phone validation (subset of rows). */
  invalidRows: ParsedContactRow[];
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false, invalidRows: [] };
  }

  const headers = lines[0]
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/["']/g, ''));

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false, invalidRows: [] };
  }

  const nameIdx    = headers.indexOf('name');
  const emailIdx   = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  const tagsIdx    = headers.indexOf('tags');

  const rows: ParsedContactRow[] = [];
  const invalidRows: ParsedContactRow[] = [];

  const INVALID_REASONS: Record<string, string> = {
    empty:               'Phone is empty',
    leading_zero:        'Remove leading 0 — use country code instead (e.g. 916... not 06...)',
    too_short:           'Number too short',
    too_long:            'Number too long',
    missing_country_code:'Missing country code (must be ≥10 digits, e.g. 916123456789)',
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const rawPhone = values[phoneIdx]?.replace(/["']/g, '').trim();
    if (!rawPhone) continue;

    const { phone, valid, reason } = sanitizeAndValidate(rawPhone);

    const row: ParsedContactRow = {
      phone,
      rowIndex: i,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsIdx >= 0 ? parseTagCell(values[tagsIdx]?.replace(/["']/g, '')) : [],
      ...(valid ? {} : { invalidPhone: INVALID_REASONS[reason!] ?? 'Invalid phone number' }),
    };

    rows.push(row);
    if (!valid) invalidRows.push(row);
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
    invalidRows,
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}


