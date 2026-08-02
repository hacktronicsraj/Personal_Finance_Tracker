const DAY_MS = 86400000;

/**
 * Month window helpers shared by Dashboard and Insights. The window is shifted
 * back one day: a "month" runs from the last day of the previous calendar month
 * to the second-to-last day of this one (e.g. August = Jul 31 → Aug 30). Months
 * still tile with no overlap; the label stays the nominal month.
 */
export function monthRange(offset = 0) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offset;
  const label = new Date(Date.UTC(y, m, 1));
  return {
    from: new Date(Date.UTC(y, m, 1) - DAY_MS).toISOString(),
    to: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59) - DAY_MS).toISOString(),
    label: label.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    monthName: label.toLocaleDateString('en-IN', { month: 'long' }),
  };
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return d.toDateString() === new Date().toDateString() ? `Today · ${label}` : label;
}

export function timeOrDay(iso: string): string {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
