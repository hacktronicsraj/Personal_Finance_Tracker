import { describe, expect, it } from 'vitest';
import { filterTxns, parseTags, type FilterableTxn } from './txns';

const mk = (o: Partial<FilterableTxn>): FilterableTxn => ({
  occurred_at: null,
  created_at: '2026-06-15T10:00:00.000Z',
  category: 'Other',
  merchant: null,
  raw_text: '',
  amount: 100,
  source: 'sms',
  tags: null,
  ...o,
});

describe('parseTags', () => {
  it('returns [] for null/empty/garbage', () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('not json')).toEqual([]);
    expect(parseTags('{"a":1}')).toEqual([]); // not an array
  });
  it('parses a JSON array and drops non-strings', () => {
    expect(parseTags('["trip","work"]')).toEqual(['trip', 'work']);
    expect(parseTags('["ok",3,null]')).toEqual(['ok']);
  });
});

describe('filterTxns (offline parity with server SQL)', () => {
  const rows: FilterableTxn[] = [
    mk({ merchant: 'SWIGGY', category: 'Food & Dining', amount: 350, source: 'sms', tags: '["work"]', occurred_at: '2026-06-10T00:00:00.000Z' }),
    mk({ merchant: 'UBER', category: 'Transport', amount: 220, source: 'shared', tags: '["trip","work"]', occurred_at: '2026-06-20T00:00:00.000Z' }),
    mk({ merchant: 'AMAZON', category: 'Shopping', amount: 5000, source: 'manual', tags: null, occurred_at: '2026-05-01T00:00:00.000Z' }),
  ];

  it('returns everything when no filter is given', () => {
    expect(filterTxns(rows)).toHaveLength(3);
    expect(filterTxns(rows, {})).toHaveLength(3);
  });

  it('filters by date window on COALESCE(occurred_at, created_at)', () => {
    const r = filterTxns(rows, { from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T23:59:59.000Z' });
    expect(r.map((t) => t.merchant)).toEqual(['SWIGGY', 'UBER']);
  });

  it('falls back to created_at when occurred_at is null', () => {
    const r = mk({ occurred_at: null, created_at: '2026-07-05T00:00:00.000Z', merchant: 'X' });
    expect(filterTxns([r], { from: '2026-07-01T00:00:00.000Z' })).toHaveLength(1);
    expect(filterTxns([r], { to: '2026-06-30T00:00:00.000Z' })).toHaveLength(0);
  });

  it('filters by single category and by multi-category (categories supersedes)', () => {
    expect(filterTxns(rows, { category: 'Transport' }).map((t) => t.merchant)).toEqual(['UBER']);
    const multi = filterTxns(rows, { category: 'Ignored', categories: ['Food & Dining', 'Shopping'] });
    expect(multi.map((t) => t.merchant)).toEqual(['SWIGGY', 'AMAZON']);
  });

  it('search matches merchant or raw_text, case-insensitively', () => {
    expect(filterTxns(rows, { q: 'swig' }).map((t) => t.merchant)).toEqual(['SWIGGY']);
    const withRaw = mk({ merchant: 'HDFC', raw_text: 'paid to NETFLIX' });
    expect(filterTxns([withRaw], { q: 'netflix' })).toHaveLength(1);
  });

  it('filters by amount bounds (inclusive)', () => {
    expect(filterTxns(rows, { minAmount: 300, maxAmount: 1000 }).map((t) => t.merchant)).toEqual(['SWIGGY']);
    expect(filterTxns(rows, { minAmount: 220, maxAmount: 350 }).map((t) => t.merchant)).toEqual(['SWIGGY', 'UBER']);
  });

  it('filters by source and by tag', () => {
    expect(filterTxns(rows, { source: 'manual' }).map((t) => t.merchant)).toEqual(['AMAZON']);
    expect(filterTxns(rows, { tag: 'trip' }).map((t) => t.merchant)).toEqual(['UBER']);
    expect(filterTxns(rows, { tag: 'work' }).map((t) => t.merchant)).toEqual(['SWIGGY', 'UBER']);
  });

  it('ANDs multiple predicates together', () => {
    const r = filterTxns(rows, { tag: 'work', source: 'shared', maxAmount: 500 });
    expect(r.map((t) => t.merchant)).toEqual(['UBER']);
  });
});
