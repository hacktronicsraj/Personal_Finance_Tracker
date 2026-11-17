import { describe, expect, it } from 'vitest';
import { dailyTotals } from '../src/usage';
import { istMidnightUtc } from '../src/ist';

const at = (day: string, h: number, m = 0) => istMidnightUtc(day) + (h * 60 + m) * 60_000;
const s = (a: number, b: number) => ({ pkg: 'ig', start_ms: a, end_ms: b });

describe('dailyTotals', () => {
  it('totals minutes, opens and longest per IST day, with empty days', () => {
    const rows = [s(at('2026-11-10', 9), at('2026-11-10', 9, 20)), s(at('2026-11-10', 21), at('2026-11-10', 22))];
    const [d1, d2] = dailyTotals(rows, '2026-11-10', 2);
    expect(d1).toMatchObject({ day: '2026-11-10', minutes: 80, opens: 2, longestMinutes: 60 });
    expect(d1.firstOpenMs).toBe(at('2026-11-10', 9));
    expect(d2).toMatchObject({ day: '2026-11-11', minutes: 0, opens: 0, firstOpenMs: null });
  });

  it('splits a session across midnight, counting the open on the start day', () => {
    const rows = [s(at('2026-11-10', 23, 30), at('2026-11-11', 0, 45))];
    const [d1, d2] = dailyTotals(rows, '2026-11-10', 2);
    expect(d1).toMatchObject({ minutes: 30, opens: 1 });
    expect(d2).toMatchObject({ minutes: 45, opens: 0 });
  });
});
