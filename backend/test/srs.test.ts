import { describe, expect, it } from 'vitest';
import { reviewCard } from '../src/assistantDb';

const fresh = { ease: 2.5, interval_days: 0, reps: 0 };
const DAY = 86_400_000;
const now = Date.parse('2026-11-12T00:00:00.000Z');
const days = (r: { due_at: string }) => Math.round((Date.parse(r.due_at) - now) / DAY);

describe('reviewCard (SM-2)', () => {
  it('schedules a new card 1 day out on first correct', () => {
    const r = reviewCard(fresh, true, now);
    expect(r.reps).toBe(1);
    expect(r.interval_days).toBe(1);
    expect(days(r)).toBe(1);
  });

  it('schedules the second correct 6 days out', () => {
    const r = reviewCard({ ease: 2.5, interval_days: 1, reps: 1 }, true, now);
    expect(r.reps).toBe(2);
    expect(r.interval_days).toBe(6);
  });

  it('multiplies by ease after the second rep', () => {
    const r = reviewCard({ ease: 2.5, interval_days: 6, reps: 2 }, true, now);
    expect(r.reps).toBe(3);
    // ease rises on a correct answer, so 6 * ~2.6
    expect(r.interval_days).toBeGreaterThan(15);
    expect(r.interval_days).toBeLessThan(17);
  });

  it('resets reps and interval to 1 day on a wrong answer', () => {
    const r = reviewCard({ ease: 2.5, interval_days: 30, reps: 5 }, false, now);
    expect(r.reps).toBe(0);
    expect(r.interval_days).toBe(1);
    expect(days(r)).toBe(1);
  });

  it('lowers ease on a wrong answer', () => {
    const r = reviewCard({ ease: 2.5, interval_days: 10, reps: 3 }, false, now);
    expect(r.ease).toBeLessThan(2.5);
  });

  it('raises ease slightly on a correct answer', () => {
    const r = reviewCard({ ease: 2.5, interval_days: 10, reps: 3 }, true, now);
    expect(r.ease).toBeGreaterThan(2.5);
  });

  it('never lets ease fall below 1.3', () => {
    let state = { ease: 1.3, interval_days: 5, reps: 1 };
    for (let i = 0; i < 20; i++) state = { ...state, ...reviewCard(state, false, now) };
    expect(state.ease).toBe(1.3);
  });

  it('keeps intervals growing for a consistently correct card', () => {
    let state = { ease: 2.5, interval_days: 0, reps: 0 };
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = reviewCard(state, true, now);
      state = { ...state, ...next };
      seen.push(next.interval_days);
    }
    // strictly non-decreasing after the first two fixed steps
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBeGreaterThan(30);
  });

  it('due_at is interval days after now', () => {
    const r = reviewCard({ ease: 2.5, interval_days: 6, reps: 2 }, true, now);
    expect(days(r)).toBe(Math.round(r.interval_days));
  });

  it('rounds ease to 3 decimals (no float drift in the DB)', () => {
    const r = reviewCard({ ease: 2.5, interval_days: 6, reps: 2 }, true, now);
    expect(String(r.ease).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });
});
