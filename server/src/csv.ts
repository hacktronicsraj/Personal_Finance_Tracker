import type { TxnRow } from './db';

/** RFC-4180 field escaping: quote when the value holds a comma, quote, or newline,
 * and double any embedded quotes. */
export function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  'date', 'amount', 'direction', 'merchant', 'category',
  'tags', 'source', 'bank', 'account_tail', 'ref_no', 'user_note',
] as const;

function tagsToField(tags: string | null): string {
  if (!tags) return '';
  try {
    const arr = JSON.parse(tags);
    return Array.isArray(arr) ? arr.filter((t) => typeof t === 'string').join(';') : '';
  } catch {
    return '';
  }
}

/** Render transactions to a CSV string (header + one row each). Pure + testable. */
export function buildCsv(rows: TxnRow[]): string {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    const date = (r.occurred_at ?? r.created_at ?? '').slice(0, 10);
    lines.push([
      date,
      r.amount,
      r.direction,
      r.merchant,
      r.category,
      tagsToField(r.tags),
      r.source,
      r.bank,
      r.account_tail,
      r.ref_no,
      r.user_note,
    ].map(csvField).join(','));
  }
  // CRLF line endings — the RFC-4180 default and what Excel expects.
  return lines.join('\r\n');
}
