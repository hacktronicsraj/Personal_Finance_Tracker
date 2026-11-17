import { describe, expect, it } from 'vitest';
import { applyAliases, buildTxnListQuery, detectRecurring, mandateMatches } from '../src/db';

describe('buildTxnListQuery', () => {
  it('returns just an ordered LIMIT when no filters are set', () => {
    const { sql, binds } = buildTxnListQuery({});
    expect(sql).not.toContain('WHERE');
    expect(sql).toContain('ORDER BY COALESCE(occurred_at, created_at) DESC');
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

describe('applyAliases', () => {
  const row = (merchant: string, norm: string) =>
    ({ merchant, merchant_norm: norm } as any);

  it('renames every row sharing the payee, keeping the bank name as merchant_raw', () => {
    const out = applyAliases(
      [row('SATYAWAN JADAV', 'SATYAWAN JADAV'), row('SATYAWAN JADAV', 'SATYAWAN JADAV')],
      [{ pattern: 'SATYAWAN JADAV', display_name: 'Evening chai stall' }],
    );
    expect(out.every((r) => r.merchant === 'Evening chai stall')).toBe(true);
    expect(out[0].merchant_raw).toBe('SATYAWAN JADAV');
  });

  it('leaves unaliased rows untouched', () => {
    const out = applyAliases([row('ZEPTO', 'ZEPTO')], [{ pattern: 'BLINKIT', display_name: 'x' }]);
    expect(out[0].merchant).toBe('ZEPTO');
    expect(out[0].merchant_raw).toBeUndefined();
  });
});

describe('detectRecurring', () => {
  const c = (at: string, amount: number) => ({ at, amount, category: 'Entertainment', merchant: 'Spotify' });

  it('spots a monthly subscription on a stable day', () => {
    const r = detectRecurring([c('2026-06-15T00:00:00Z', 299), c('2026-07-15T00:00:00Z', 299), c('2026-08-15T00:00:00Z', 299)]);
    expect(r?.frequency).toBe('monthly');
    expect(r?.amount).toBe(299);
    expect(r?.dayOfCycle).toBe(15);
    expect(r?.occurrences).toBe(3);
  });

  it('tolerates a small price change and a few days of drift', () => {
    const r = detectRecurring([c('2026-06-15T00:00:00Z', 299), c('2026-07-17T00:00:00Z', 329)]);
    expect(r?.frequency).toBe('monthly');
  });

  it('rejects a big price swing', () => {
    expect(detectRecurring([c('2026-06-15T00:00:00Z', 100), c('2026-07-15T00:00:00Z', 900)])).toBeNull();
  });

  it('rejects same-month bursts at one shop', () => {
    expect(detectRecurring([c('2026-08-03T00:00:00Z', 47), c('2026-08-04T00:00:00Z', 47), c('2026-08-06T00:00:00Z', 47)])).toBeNull();
  });

  it('needs more than one sighting when there is no autopay marker', () => {
    expect(detectRecurring([c('2026-08-15T00:00:00Z', 299)])).toBeNull();
  });

  it('trusts a single self-declared autopay charge', () => {
    // "...towards Groww for UPI Mandate AutoPay" — the SMS proves the mandate.
    const r = detectRecurring([
      { at: '2026-08-17T00:00:00Z', amount: 3500, category: 'Other', merchant: 'Groww', autopay: true },
    ]);
    expect(r?.frequency).toBe('monthly');
    expect(r?.dayOfCycle).toBe(17);
    expect(r?.amount).toBe(3500);
    expect(r?.confidence).toBeLessThan(0.9);
  });

  it('is more confident once an autopay has charged twice', () => {
    const r = detectRecurring([
      { at: '2026-07-17T00:00:00Z', amount: 3500, category: 'Other', merchant: 'Groww', autopay: true },
      { at: '2026-08-17T00:00:00Z', amount: 3500, category: 'Other', merchant: 'Groww', autopay: true },
    ]);
    expect(r?.confidence).toBe(0.9);
  });

  it('spots a weekly cycle', () => {
    const r = detectRecurring([c('2026-08-01T00:00:00Z', 500), c('2026-08-08T00:00:00Z', 500), c('2026-08-15T00:00:00Z', 500)]);
    expect(r?.frequency).toBe('weekly');
  });
});
