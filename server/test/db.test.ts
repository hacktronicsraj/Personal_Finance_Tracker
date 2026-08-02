import { describe, expect, it } from 'vitest';
import { buildTxnListQuery, mandateMatches } from '../src/db';

describe('buildTxnListQuery', () => {
  it('returns just an ordered LIMIT when no filters are set', () => {
    const { sql, binds } = buildTxnListQuery({});
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(binds).toEqual([200]); // default limit, last bind
  });

  it('applies amount bounds and source, binds in clause order with limit last', () => {
    const { sql, binds } = buildTxnListQuery({ minAmount: 100, maxAmount: 500, source: 'sms', limit: 50 });
    expect(sql).toContain('amount >= ?');
    expect(sql).toContain('amount <= ?');
    expect(sql).toContain('source = ?');
    expect(binds).toEqual([100, 500, 'sms', 50]);
  });

  it('filters by tag via json_each existence', () => {
    const { sql, binds } = buildTxnListQuery({ tag: 'trip' });
    expect(sql).toContain('EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)');
    expect(binds).toEqual(['trip', 200]);
  });

  it('expands a multi-category selection into an IN clause', () => {
    const { sql, binds } = buildTxnListQuery({ categories: ['Food & Dining', 'Transport'] });
    expect(sql).toContain('category IN (?,?)');
    expect(binds).toEqual(['Food & Dining', 'Transport', 200]);
  });

  it('multi-category supersedes single category; empty list falls back to single', () => {
    expect(buildTxnListQuery({ category: 'X', categories: ['A', 'B'] }).sql).toContain('category IN (?,?)');
    const single = buildTxnListQuery({ category: 'X', categories: [] });
    expect(single.sql).toContain('category = ?');
    expect(single.sql).not.toContain('IN (');
  });

  it('wraps a search term with LIKE wildcards across merchant and raw_text', () => {
    const { sql, binds } = buildTxnListQuery({ search: 'swiggy' });
    expect(sql).toContain('(merchant LIKE ? OR raw_text LIKE ?)');
    expect(binds).toEqual(['%swiggy%', '%swiggy%', 200]);
  });
});

describe('mandateMatches', () => {
  const netflix = { name: 'Netflix', amount: 499, day_of_cycle: 15, merchant_hint: 'NETFLIX' };

  it('matches within the amount, day, and merchant window', () => {
    expect(mandateMatches(netflix, { merchant: 'NETFLIX.COM', amount: 499, dayOfMonth: 15 })).toBe(true);
  });

  it('accepts amount within ±20% but rejects beyond it', () => {
    expect(mandateMatches(netflix, { merchant: 'NETFLIX', amount: 590, dayOfMonth: 15 })).toBe(true); // +18%
    expect(mandateMatches(netflix, { merchant: 'NETFLIX', amount: 650, dayOfMonth: 15 })).toBe(false); // +30%
  });

  it('accepts day within ±3 and wraps across the month boundary', () => {
    expect(mandateMatches(netflix, { merchant: 'NETFLIX', amount: 499, dayOfMonth: 18 })).toBe(true);
    expect(mandateMatches(netflix, { merchant: 'NETFLIX', amount: 499, dayOfMonth: 19 })).toBe(false);
    const monthEnd = { name: 'Rent', amount: 20000, day_of_cycle: 1, merchant_hint: null };
    expect(mandateMatches(monthEnd, { merchant: 'RENT LLC', amount: 20000, dayOfMonth: 30 })).toBe(true); // 31-29=2
  });

  it('falls back to a name token match (≥3 chars) when there is no hint', () => {
    const gym = { name: 'Cult Fit', amount: 1000, day_of_cycle: 5, merchant_hint: null };
    expect(mandateMatches(gym, { merchant: 'CULT.FIT MEMBERSHIP', amount: 1000, dayOfMonth: 5 })).toBe(true);
    expect(mandateMatches(gym, { merchant: 'RANDOM VENDOR', amount: 1000, dayOfMonth: 5 })).toBe(false);
  });

  it('rejects when the merchant does not match at all', () => {
    expect(mandateMatches(netflix, { merchant: 'AMAZON PRIME', amount: 499, dayOfMonth: 15 })).toBe(false);
  });
});
