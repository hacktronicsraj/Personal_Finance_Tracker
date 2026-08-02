/**
 * Pure function: compute the next due date for a mandate.
 * Clamps day 29–31 to month end for months that don't have those days.
 */
export function nextDueDate(dayOfCycle: number, frequency: string, lastPaidDate?: string): Date {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (frequency === 'weekly') {
    // dayOfCycle = 0 (Sun) through 6 (Sat)
    const dow = dayOfCycle % 7;
    const diff = (dow - today.getDay() + 7) % 7;
    const next = new Date(today);
    next.setDate(today.getDate() + (diff === 0 ? 0 : diff));
    // If today and already past or has a lastPaidDate today, push to next week
    if (next <= today && lastPaidDate) {
      const lp = new Date(lastPaidDate);
      if (lp.getFullYear() === today.getFullYear() && lp.getMonth() === today.getMonth() && lp.getDate() === today.getDate()) {
        next.setDate(next.getDate() + 7);
      }
    }
    return next;
  }

  // Monthly/quarterly/yearly: find next occurrence of day_of_cycle
  const clampDay = (year: number, month: number, day: number) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return Math.min(day, lastDay);
  };

  let m = today.getMonth();
  let y = today.getFullYear();
  let clamped = clampDay(y, m, dayOfCycle);
  let candidate = new Date(y, m, clamped);

  // If today or future, that's our candidate for this period
  if (candidate < today) {
    // Move to next period
    const step = frequency === 'quarterly' ? 3 : frequency === 'yearly' ? 12 : 1;
    m += step;
    if (m >= 12) { y += Math.floor(m / 12); m = m % 12; }
    clamped = clampDay(y, m, dayOfCycle);
    candidate = new Date(y, m, clamped);
  }

  return candidate;
}

export function formatDueDate(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `In ${diffDays} days`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Relative label + the concrete calendar date: "Today · 17 Jul", "In 3 days · 20 Jul",
 * or just "Due 5 Aug" once the relative label IS the date. */
export function formatDueWithDate(date: Date): string {
  const rel = formatDueDate(date);
  const abs = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return rel === abs ? `Due ${abs}` : `${rel} · ${abs}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human label for the mandate's cycle anchor: weekly = weekday name, else day of month. */
export function cycleLabel(dayOfCycle: number, frequency: string): string {
  if (frequency === 'weekly') return `Every ${WEEKDAYS[dayOfCycle % 7]}`;
  return `Day ${dayOfCycle}`;
}

export interface EmiInfo {
  total: number;
  paid: number;
  remaining: number;
  done: boolean;
}

/**
 * Progress of an EMI: how many installments have already come due (inclusive of
 * today), out of the tenure. Returns null when the mandate isn't an EMI
 * (emi_total / emi_start not set). Pure.
 */
export function emiProgress(
  m: { emi_total: number | null; emi_start: string | null; frequency: string },
  now: Date = new Date(),
): EmiInfo | null {
  if (!m.emi_total || !m.emi_start) return null;
  const total = m.emi_total;
  const start = new Date(m.emi_start);
  if (isNaN(start.getTime())) return null;
  const stepMonths = m.frequency === 'quarterly' ? 3 : m.frequency === 'yearly' ? 12 : 1;

  let paid = 0;
  for (let k = 0; k < total; k++) {
    let due: Date;
    if (m.frequency === 'weekly') {
      due = new Date(start.getTime() + k * 7 * 86400000);
    } else {
      // Clamp the anchor day to the target month's length (like nextDueDate) so a
      // day 29–31 EMI doesn't roll into the next month on short months.
      const y = start.getFullYear();
      const mo = start.getMonth() + k * stepMonths;
      const lastDay = new Date(y, mo + 1, 0).getDate();
      due = new Date(y, mo, Math.min(start.getDate(), lastDay));
    }
    if (due.getTime() <= now.getTime()) paid++;
    else break;
  }
  return { total, paid, remaining: Math.max(0, total - paid), done: paid >= total };
}

export const PLATFORMS = [
  { value: 'gpay', label: 'Google Pay' },
  { value: 'phonepe', label: 'PhonePe' },
  { value: 'paytm', label: 'Paytm' },
  { value: 'bank_autopay', label: 'Bank Autopay' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
] as const;

export function platformLabel(p: string): string {
  return PLATFORMS.find((x) => x.value === p)?.label ?? p;
}
