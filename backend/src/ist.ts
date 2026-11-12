/** India Standard Time helpers. IST is a fixed UTC+5:30 (no DST). A "day" is an
 * IST calendar date string 'YYYY-MM-DD'. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istDayOfIso(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? istDay(ms) : iso.slice(0, 10);
}

export function istMidnightUtc(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`) - IST_OFFSET_MS;
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days b - a between two IST date strings. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
