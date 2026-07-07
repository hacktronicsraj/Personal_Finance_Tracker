/** Month window helpers shared by Dashboard and Insights. */
export function monthRange(offset = 0) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offset;
  const first = new Date(Date.UTC(y, m, 1));
  return {
    from: first.toISOString(),
    to: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59)).toISOString(),
    label: first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    monthName: first.toLocaleDateString('en-IN', { month: 'long' }),
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
