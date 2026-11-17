import { describe, expect, it } from 'vitest';
import {
  DAILY_CAP_MIN,
  decideOpen,
  endSession,
  freshState,
  grantSession,
  isNight,
  istDay,
  makeMathChallenge,
  rolled,
  type GateState,
} from './gate';

// 2026-09-22, IST times
const at = (h: number, m = 0) => Date.parse('2026-09-22T00:00:00.000Z') - 5.5 * 3600_000 + (h * 60 + m) * 60_000;
const day = '2026-09-22';
const base = (over: Partial<GateState> = {}): GateState => ({ ...freshState(day), ...over });

describe('isNight (23:00–06:00 IST)', () => {
  it('is night late and early, day otherwise', () => {
    expect(isNight(at(23, 30))).toBe(true);
    expect(isNight(at(2, 0))).toBe(true);
    expect(isNight(at(5, 59))).toBe(true);
    expect(isNight(at(6, 0))).toBe(false);
    expect(isNight(at(14, 0))).toBe(false);
    expect(isNight(at(22, 59))).toBe(false);
  });
});

describe('decideOpen', () => {
  it('daytime under the cap → flashcards', () => {
    expect(decideOpen(base(), 10, at(14)).reason).toBe('flashcards');
  });

  it('night under the cap → math', () => {
    expect(decideOpen(base(), 10, at(23, 30)).reason).toBe('math');
    expect(decideOpen(base(), 0, at(3)).reason).toBe('math');
  });

  it('cap reached → blocked all day, no override (even at night, even with a session)', () => {
    expect(decideOpen(base(), 30, at(14))).toMatchObject({ allowed: false, reason: 'capped', minutesLeft: 0 });
    expect(decideOpen(base(), 31, at(3)).reason).toBe('capped');
    expect(decideOpen(base({ sessionActive: true }), 30, at(14)).reason).toBe('capped');
  });

  it('an active session is allowed while under the cap', () => {
    expect(decideOpen(base({ sessionActive: true }), 10, at(14))).toMatchObject({ allowed: true, reason: 'allow' });
  });

  it('reports minutes left', () => {
    expect(decideOpen(base(), 12, at(14)).minutesLeft).toBe(DAILY_CAP_MIN - 12);
  });
});

describe('session lifecycle', () => {
  it('grant then end toggles sessionActive; no keys involved', () => {
    let s = grantSession(base(), at(14));
    expect(s.sessionActive).toBe(true);
    expect(decideOpen(s, 5, at(14)).allowed).toBe(true);
    s = endSession(s, at(14));
    expect(s.sessionActive).toBe(false);
    expect(decideOpen(s, 5, at(14)).reason).toBe('flashcards');
  });
});

describe('daily rollover', () => {
  it('resets the session on a new IST day', () => {
    const yesterday: GateState = { day: '2026-09-21', sessionActive: true };
    expect(rolled(yesterday, day)).toEqual(freshState(day));
  });
});

describe('makeMathChallenge', () => {
  it('produces a solvable problem whose answer matches the prompt', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeMathChallenge();
      expect(c.prompt).toMatch(/[0-9]+ [×＋+−-] [0-9]+/);
      const [a, op, b] = c.prompt.split(' ');
      const x = Number(a), y = Number(b);
      const expected = op === '×' ? x * y : op === '−' ? x - y : x + y;
      expect(c.answer).toBe(expected);
      if (op === '−') expect(c.answer).toBeGreaterThanOrEqual(0); // no negatives
    }
  });
});
