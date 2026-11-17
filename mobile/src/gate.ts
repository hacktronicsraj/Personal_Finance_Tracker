/**
 * The Instagram gate — pure decision logic, shared by the JS screens and mirrored
 * into native SharedPreferences for the AccessibilityService that enforces it.
 *
 * Rules (all times IST), per the user's spec:
 *  • Cumulative Instagram use is capped at 30 minutes per day. Once you cross it,
 *    Instagram is blocked for the rest of the day — no override.
 *  • Every time you open Instagram (while under the cap) you must answer 5 fresh
 *    flashcards correctly. Any wrong answer → a new set of 5 (retry).
 *  • Between 23:00 and 06:00 the gate is an easy/medium math problem instead of
 *    flashcards.
 *  • No keys, no blanket, no on/off toggle — the guard is always on.
 */

export const DAILY_CAP_MIN = 30;
export const NIGHT_START_MIN = 23 * 60; // 23:00
export const NIGHT_END_MIN = 6 * 60; // 06:00
export const FLASHCARDS_TO_PASS = 5;
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface GateState {
  day: string; // IST YYYY-MM-DD this state belongs to
  sessionActive: boolean; // a granted Instagram session is currently open
}

export type GateReason = 'capped' | 'math' | 'flashcards' | 'allow';

export interface GateDecision {
  allowed: boolean; // may Instagram be shown right now without a new gate?
  reason: GateReason;
  usedMinutes: number;
  minutesLeft: number;
}

export function istDay(ms = Date.now()): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istMinutes(ms = Date.now()): number {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 23:00–06:00 IST is the night window (math challenge instead of flashcards). */
export function isNight(ms = Date.now()): boolean {
  const m = istMinutes(ms);
  return m >= NIGHT_START_MIN || m < NIGHT_END_MIN;
}

export function freshState(day = istDay()): GateState {
  return { day, sessionActive: false };
}

export function rolled(state: GateState | null | undefined, day = istDay()): GateState {
  if (!state || state.day !== day) return freshState(day);
  return state;
}

/**
 * What should happen when Instagram is opened right now. `usedMinutes` is today's
 * cumulative Instagram foreground time (from UsageStats). Order: the daily cap is
 * absolute; then an already-granted session; then night → math, day → flashcards.
 */
export function decideOpen(
  stateIn: GateState | null | undefined,
  usedMinutes: number,
  nowMs = Date.now(),
): GateDecision {
  const state = rolled(stateIn, istDay(nowMs));
  const minutesLeft = Math.max(0, DAILY_CAP_MIN - usedMinutes);
  if (usedMinutes >= DAILY_CAP_MIN) return { allowed: false, reason: 'capped', usedMinutes, minutesLeft: 0 };
  if (state.sessionActive) return { allowed: true, reason: 'allow', usedMinutes, minutesLeft };
  if (isNight(nowMs)) return { allowed: false, reason: 'math', usedMinutes, minutesLeft };
  return { allowed: false, reason: 'flashcards', usedMinutes, minutesLeft };
}

/** Grant a session (the user cleared the gate). */
export function grantSession(stateIn: GateState | null | undefined, nowMs = Date.now()): GateState {
  return { ...rolled(stateIn, istDay(nowMs)), sessionActive: true };
}

/** End the session — called when Instagram is left. No key is spent; the 30-min
 * cap is the limiter, and the next open must clear the gate again. */
export function endSession(stateIn: GateState | null | undefined, nowMs = Date.now()): GateState {
  return { ...rolled(stateIn, istDay(nowMs)), sessionActive: false };
}

/* ─────────────────────────── Math challenge ─────────────────────────── */

export interface MathChallenge {
  prompt: string;
  answer: number;
}

/** An easy/medium arithmetic problem for the night gate. Deterministic to grade. */
export function makeMathChallenge(rng: () => number = Math.random): MathChallenge {
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)];
  const kind = pick(['add', 'sub', 'mul']);
  if (kind === 'mul') {
    const a = 2 + Math.floor(rng() * 11); // 2..12
    const b = 3 + Math.floor(rng() * 20); // 3..22
    return { prompt: `${a} × ${b}`, answer: a * b };
  }
  if (kind === 'sub') {
    const a = 20 + Math.floor(rng() * 80); // 20..99
    const b = 1 + Math.floor(rng() * (a - 1));
    return { prompt: `${a} − ${b}`, answer: a - b };
  }
  const a = 15 + Math.floor(rng() * 85);
  const b = 15 + Math.floor(rng() * 85);
  return { prompt: `${a} + ${b}`, answer: a + b };
}
