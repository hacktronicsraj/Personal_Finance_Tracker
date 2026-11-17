/**
 * India Standard Time helpers. IST is a fixed UTC+5:30 with no DST, so plain
 * offset arithmetic is exact. A "day" everywhere in the assistant features is an
 * IST calendar date string 'YYYY-MM-DD'.
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** IST calendar date of an instant. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST calendar date of an ISO timestamp (date-only strings are taken as-is). */
export function istDayOfIso(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? istDay(ms) : iso.slice(0, 10);
}

/** UTC instant of 00:00 IST on `day`. */
export function istMidnightUtc(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - IST_OFFSET_MS;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a) between two IST date strings. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / DAY_MS);
}

export function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
}
