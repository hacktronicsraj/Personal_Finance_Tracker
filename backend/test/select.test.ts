import { describe, expect, it } from 'vitest';
import { selectQuiz, type SrsCard } from '../src/srs';

const now = Date.parse('2026-11-16T12:00:00.000Z');
const H = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function card(p: Partial<SrsCard> = {}): SrsCard {
  return {
    id: `c${seq++}`,
    deck: 'geography',
    grp: null,
    reps: 0,
    due_at: null,
    last_shown_at: null,
    introduced_at: null,
    times_shown: 0,
    ...p,
  };
}
const learned = (dueOffsetMs: number, p: Partial<SrsCard> = {}) =>
  card({ reps: 2, times_shown: 3, introduced_at: iso(now - 30 * 24 * H), due_at: iso(now + dueOffsetMs), last_shown_at: iso(now - 5 * 24 * H), ...p });

const fixed = () => 0.5;

describe('selectQuiz', () => {
  it('puts due reviews ahead of new cards', () => {
    const due = [learned(-H), learned(-2 * H)];
    const fresh = Array.from({ length: 10 }, () => card());
    const out = selectQuiz([...fresh, ...due], 3, { nowMs: now, introducedToday: 0 });
    for (const d of due) expect(out).toContain(d);
  });

  it('caps new cards per day, preferring not-yet-due reviews once the cap is hit', () => {
    const fresh = Array.from({ length: 10 }, () => card());
    const notDue = Array.from({ length: 5 }, () => learned(3 * 24 * H));
    const out = selectQuiz([...fresh, ...notDue], 5, { nowMs: now, introducedToday: 18, newPerDay: 20 });
    expect(out.filter((c) => c.times_shown === 0)).toHaveLength(2);
    expect(out).toHaveLength(5);
  });

  it('still fills the set with new cards past the cap rather than showing too few', () => {
    const fresh = Array.from({ length: 10 }, () => card());
    const out = selectQuiz(fresh, 7, { nowMs: now, introducedToday: 20, newPerDay: 20 });
    expect(out).toHaveLength(7);
  });

  it('never puts two siblings in one quiz', () => {
    const cards = ['FR', 'DE', 'IT'].flatMap((c) => [card({ grp: `geo:${c}` }), card({ grp: `geo:${c}` }), card({ grp: `geo:${c}` })]);
    const out = selectQuiz(cards, 3, { nowMs: now, introducedToday: 0 });
    expect(new Set(out.map((c) => c.grp)).size).toBe(out.length);
  });

  it('holds back a new card whose sibling was seen in the last day', () => {
    const seen = learned(24 * H, { grp: 'geo:FR', last_shown_at: iso(now - H) });
    const sibling = card({ grp: 'geo:FR' });
    const other = Array.from({ length: 3 }, () => card());
    const out = selectQuiz([seen, sibling, ...other], 3, { nowMs: now, introducedToday: 0 });
    expect(out).not.toContain(sibling);
  });

  it('serves the most overdue review first when reviews exceed the set', () => {
    const a = learned(-10 * H);
    const b = learned(-1 * H);
    const c = learned(-5 * H);
    const out = selectQuiz([b, c, a], 2, { nowMs: now, introducedToday: 0, random: fixed });
    expect(out).toContain(a);
    expect(out).toContain(c);
  });

  it('does not re-show a card seen minutes ago while others are available', () => {
    const justSeen = learned(24 * H, { last_shown_at: iso(now - 5 * 60_000) });
    const fresh = Array.from({ length: 3 }, () => card());
    const out = selectQuiz([justSeen, ...fresh], 3, { nowMs: now, introducedToday: 50, newPerDay: 20 });
    expect(out).not.toContain(justSeen);
  });

  it('treats legacy reviewed cards (no introduced_at) as learned, not new', () => {
    const legacy = card({ times_shown: 4, reps: 3, due_at: iso(now - H), introduced_at: null });
    const out = selectQuiz([legacy, card()], 1, { nowMs: now, introducedToday: 0 });
    expect(out).toEqual([legacy]);
  });
});

describe('selectQuiz — introduction order', () => {
  it('introduces new cards in new_order within a deck', () => {
    const cards = [5, 1, 9, 3, 7].map((o) => card({ new_order: o }));
    const out = selectQuiz(cards, 3, { nowMs: now, introducedToday: 0, random: () => 0.5 });
    expect(out.map((c) => c.new_order).sort()).toEqual([1, 3, 5]);
  });

  it('lets a second deck take turns instead of waiting behind a big one', () => {
    const geo = Array.from({ length: 10 }, (_, i) => card({ deck: 'geography', new_order: i }));
    const other = Array.from({ length: 2 }, () => card({ deck: 'inference' }));
    const out = selectQuiz([...geo, ...other], 4, { nowMs: now, introducedToday: 0 });
    expect(out.filter((c) => c.deck === 'inference')).toHaveLength(2);
  });
});
