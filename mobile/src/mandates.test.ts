import { describe, expect, it } from 'vitest';
import { emiProgress } from './mandates';

// Build ISO strings from LOCAL components so the round-trip through new Date()
// inside emiProgress is timezone-independent.
const localISO = (y: number, m0: number, d: number) => new Date(y, m0, d).toISOString();

describe('emiProgress', () => {
  it('returns null when it is not an EMI', () => {
    expect(emiProgress({ emi_total: null, emi_start: null, frequency: 'monthly' })).toBeNull();
    expect(emiProgress({ emi_total: 12, emi_start: null, frequency: 'monthly' })).toBeNull();
    expect(emiProgress({ emi_total: null, emi_start: localISO(2026, 4, 2), frequency: 'monthly' })).toBeNull();
  });

  it('counts installments that have come due (inclusive of today)', () => {
    // First installment 2 May 2026; "now" = 2 Aug 2026 → May, Jun, Jul, Aug = 4 paid.
    const p = emiProgress(
      { emi_total: 12, emi_start: localISO(2026, 4, 2), frequency: 'monthly' },
      new Date(2026, 7, 2, 12, 0, 0),
    );
    expect(p).toEqual({ total: 12, paid: 4, remaining: 8, done: false });
  });

  it('does not count a future installment before its day arrives', () => {
    // First installment on the 15th; "now" = 10 Aug (before this month's due) → only
    // May, Jun, Jul have come due = 3.
    const p = emiProgress(
      { emi_total: 12, emi_start: localISO(2026, 4, 15), frequency: 'monthly' },
      new Date(2026, 7, 10, 12, 0, 0),
    );
    expect(p?.paid).toBe(3);
  });

  it('marks done once every installment has come due, capped at the tenure', () => {
    const p = emiProgress(
      { emi_total: 12, emi_start: localISO(2024, 0, 5), frequency: 'monthly' },
      new Date(2026, 7, 2),
    );
    expect(p).toEqual({ total: 12, paid: 12, remaining: 0, done: true });
  });

  it('steps by 3 months for a quarterly EMI', () => {
    const p = emiProgress(
      { emi_total: 8, emi_start: localISO(2026, 0, 10), frequency: 'quarterly' },
      new Date(2026, 7, 2), // Jan, Apr, Jul due by early Aug = 3
    );
    expect(p?.paid).toBe(3);
  });

  it('clamps a day-31 anchor to short months (Feb installment counts on the 28th)', () => {
    // Start 31 Jan 2026; "now" = 1 Mar 2026. Jan 31 + Feb 28 (clamped) are due; Mar 31 is not.
    const p = emiProgress(
      { emi_total: 12, emi_start: localISO(2026, 0, 31), frequency: 'monthly' },
      new Date(2026, 2, 1, 12, 0, 0),
    );
    expect(p?.paid).toBe(2); // would be 1 without clamping (Feb would roll to Mar 3)
  });

  it('steps by 7 days for a weekly EMI', () => {
    const p = emiProgress(
      { emi_total: 10, emi_start: localISO(2026, 6, 1), frequency: 'weekly' },
      new Date(2026, 6, 22, 12, 0, 0), // Jul 1, 8, 15, 22 = 4
    );
    expect(p?.paid).toBe(4);
  });
});
