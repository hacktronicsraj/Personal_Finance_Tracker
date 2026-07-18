/**
 * Pure transaction-filtering helpers — no native/expo imports, so they run under
 * vitest and are shared by the online query params and the offline cache path.
 * Keeping the offline predicate here (rather than inline in the client) is what
 * lets offline results match the server's SQL filters exactly.
 */

export interface TagTotal {
  tag: string;
  count: number;
  total: number;
}

/** Filters accepted by the transactions list (mirrors the server query params). */
export interface TxnFilters {
  from?: string;
  to?: string;
  category?: string;
  categories?: string[];
  q?: string;
  minAmount?: number;
  maxAmount?: number;
  source?: string;
  tag?: string;
}

/** The subset of a transaction the offline filter needs — TxnRow satisfies it. */
export interface FilterableTxn {
  occurred_at: string | null;
  created_at: string;
  category: string;
  merchant: string | null;
  raw_text: string;
  amount: number;
  source: string;
  tags: string | null;
}

/** Parse the `tags` JSON column into a string[] (empty on null/garbage). */
export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const arr = JSON.parse(tags);
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Apply the same filter matrix the server applies, but over an in-memory list —
 * used by the offline cache fallback so offline results match online exactly.
 */
export function filterTxns<T extends FilterableTxn>(rows: T[], f?: TxnFilters): T[] {
  if (!f) return rows;
  const q = f.q?.toLowerCase();
  const cats = f.categories?.length ? new Set(f.categories) : undefined;
  return rows.filter((t) => {
    const when = t.occurred_at ?? t.created_at;
    if (f.from && when < f.from) return false;
    if (f.to && when > f.to) return false;
    if (cats) { if (!cats.has(t.category)) return false; }
    else if (f.category && t.category !== f.category) return false;
    if (q) {
      const hay = `${t.merchant ?? ''}\n${t.raw_text ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (typeof f.minAmount === 'number' && t.amount < f.minAmount) return false;
    if (typeof f.maxAmount === 'number' && t.amount > f.maxAmount) return false;
    if (f.source && t.source !== f.source) return false;
    if (f.tag && !parseTags(t.tags).includes(f.tag)) return false;
    return true;
  });
}
