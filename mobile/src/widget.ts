import { NativeModules } from 'react-native';
import { fetchMandates, type MandateRow } from './api/client';
import { getCachedTxns } from './db/database';
import { monthRange } from './dates';
import { nextDueDate } from './mandates';

const { SpendWidget } = NativeModules as {
  SpendWidget?: { setData(json: string): Promise<boolean> };
};

/** This-month debit total from the local cache (offline-friendly). */
async function computeMonthTotal(): Promise<number> {
  const txns = await getCachedTxns(1000);
  const { from, to } = monthRange(0);
  return txns
    .filter((t) => t.direction === 'debit')
    .filter((t) => {
      const w = t.occurred_at ?? t.created_at;
      return w >= from && w <= to;
    })
    .reduce((s, t) => s + t.amount, 0);
}

/** Nearest upcoming active mandate (best-effort; network). */
async function computeNextMandate(): Promise<{ name: string; amount: number; date: Date } | null> {
  try {
    const active = (await fetchMandates()).filter((m) => m.active);
    let best: { m: MandateRow; date: Date } | null = null;
    for (const m of active) {
      const date = nextDueDate(m.day_of_cycle, m.frequency);
      if (!best || date < best.date) best = { m, date };
    }
    return best ? { name: best.m.name, amount: best.m.amount, date: best.date } : null;
  } catch {
    return null;
  }
}

/**
 * Push fresh data (this-month spend + next mandate + timestamp) to the home-screen
 * widget. Event-driven — call on foreground/sync and after a background SMS ingest.
 * No-op when the native widget module is absent (older builds) or on any failure.
 */
export async function refreshWidget(): Promise<void> {
  if (!SpendWidget?.setData) return;
  try {
    const [monthTotal, mandate] = await Promise.all([computeMonthTotal(), computeNextMandate()]);
    const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
    const data: Record<string, string> = {
      monthTotal: fmt(monthTotal),
      updatedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    };
    if (mandate) {
      data.mandateName = mandate.name;
      data.mandateAmount = fmt(mandate.amount);
      data.mandateDate = mandate.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    await SpendWidget.setData(JSON.stringify(data));
  } catch {
    /* widget refresh is best-effort */
  }
}
