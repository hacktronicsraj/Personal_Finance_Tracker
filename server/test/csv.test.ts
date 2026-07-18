import { describe, expect, it } from 'vitest';
import { buildCsv, csvField } from '../src/csv';
import type { TxnRow } from '../src/db';

const row = (o: Partial<TxnRow>): TxnRow => ({
  id: 'x', device_id: null, dedupe_key: null, raw_text: '', amount: 100, direction: 'debit',
  currency: 'INR', bank: null, merchant: null, account_tail: null, ref_no: null, balance: null,
  occurred_at: null, category: 'Other', confidence: 0, notes: null, user_note: null, tags: null,
  mandate_id: null, source: 'sms', corrected: 0, created_at: '2026-07-01T10:00:00.000Z',
  updated_at: '2026-07-01T10:00:00.000Z', ...o,
});

describe('csvField', () => {
  it('leaves plain values unquoted', () => {
    expect(csvField('SWIGGY')).toBe('SWIGGY');
    expect(csvField(350)).toBe('350');
    expect(csvField(null)).toBe('');
  });
  it('quotes and escapes commas, quotes, and newlines', () => {
    expect(csvField('Cafe, Bar')).toBe('"Cafe, Bar"');
    expect(csvField('5" pizza')).toBe('"5"" pizza"');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('buildCsv', () => {
  it('emits a header and CRLF-separated rows', () => {
    const csv = buildCsv([row({ merchant: 'SWIGGY', amount: 350, category: 'Food & Dining' })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('date,amount,direction,merchant,category,tags,source,bank,account_tail,ref_no,user_note');
    expect(lines[1]).toBe('2026-07-01,350,debit,SWIGGY,Food & Dining,,sms,,,,');
  });

  it('uses occurred_at for the date when present, else created_at', () => {
    const csv = buildCsv([row({ occurred_at: '2026-06-20T00:00:00.000Z' })]);
    expect(csv.split('\r\n')[1].startsWith('2026-06-20,')).toBe(true);
  });

  it('joins tags with semicolons and escapes a comma-bearing merchant', () => {
    const csv = buildCsv([row({ merchant: 'Cafe, Bar', tags: '["trip","work"]' })]);
    const cells = csv.split('\r\n')[1];
    expect(cells).toContain('"Cafe, Bar"');
    expect(cells).toContain('trip;work');
  });

  it('escapes a user_note containing a quote and newline', () => {
    const csv = buildCsv([row({ user_note: 'said "hi"\nthen left' })]);
    expect(csv.split('\r\n').slice(1).join('\r\n')).toContain('"said ""hi""\nthen left"');
  });
});
