import { describe, expect, it } from 'vitest';
import {
  weekWindowIST,
  monthWindowIST,
  renderReportHtml,
  fallbackInsights,
  escapeHtml,
  type ReportStats,
} from '../src/reports';

const IST_OFFSET = 5.5 * 60 * 60 * 1000;
const istParts = (iso: string) => {
  const d = new Date(Date.parse(iso) + IST_OFFSET);
  return { day: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() };
};

describe('weekWindowIST', () => {
  it('returns a Mon 00:00 IST → Sun 23:59:59.999 IST window', () => {
    // 2026-07-12 is a Sunday; cron fires 14:30 UTC (20:00 IST).
    const w = weekWindowIST(Date.parse('2026-07-12T14:30:00.000Z'));
    const start = istParts(w.start);
    expect(start.day).toBe(1); // Monday
    expect(start.h).toBe(0);
    expect(start.m).toBe(0);
    // 7-day window, inclusive to the last millisecond.
    expect(Date.parse(w.end) - Date.parse(w.start)).toBe(7 * 86400000 - 1);
    const end = istParts(w.end);
    expect(end.day).toBe(0); // Sunday
    expect(end.h).toBe(23);
  });

  it('includes the firing instant and abuts the previous week exactly', () => {
    const now = Date.parse('2026-07-12T14:30:00.000Z');
    const w = weekWindowIST(now);
    expect(Date.parse(w.start)).toBeLessThanOrEqual(now);
    expect(Date.parse(w.end)).toBeGreaterThanOrEqual(now);
    expect(Date.parse(w.prevEnd)).toBe(Date.parse(w.start) - 1);
    expect(Date.parse(w.start) - Date.parse(w.prevStart)).toBe(7 * 86400000);
  });

  it('picks the current week Monday from a mid-week timestamp too', () => {
    const w = weekWindowIST(Date.parse('2026-07-08T09:00:00.000Z')); // a Wednesday
    expect(istParts(w.start).day).toBe(1);
    expect(Date.parse(w.start)).toBeLessThanOrEqual(Date.parse('2026-07-08T09:00:00.000Z'));
  });
});

describe('monthWindowIST', () => {
  it('covers the current IST calendar month at offset 0', () => {
    const w = monthWindowIST(Date.parse('2026-07-17T06:00:00.000Z'));
    expect(w.start).toBe(new Date(Date.UTC(2026, 6, 1) - 5.5 * 3600000).toISOString()); // 1 Jul 00:00 IST
    expect(w.end).toBe(new Date(Date.UTC(2026, 7, 1) - 5.5 * 3600000 - 1).toISOString()); // 31 Jul 23:59:59.999 IST
    expect(w.label).toBe('July 2026');
  });

  it('offset steps whole months back and abuts the previous month', () => {
    const w = monthWindowIST(Date.parse('2026-07-17T06:00:00.000Z'), 1);
    expect(w.label).toBe('June 2026');
    expect(Date.parse(w.prevEnd)).toBe(Date.parse(w.start) - 1);
  });

  it('handles year boundaries (January minus one = December)', () => {
    const w = monthWindowIST(Date.parse('2026-01-15T06:00:00.000Z'), 1);
    expect(w.label).toBe('December 2025');
  });

  it('monthly-cron moment (00:00 IST on the 1st) with offset 1 = just-ended month', () => {
    // 31 Jul 18:30 UTC = 1 Aug 00:00 IST
    const w = monthWindowIST(Date.parse('2026-07-31T18:30:00.000Z'), 1);
    expect(w.label).toBe('July 2026');
  });
});

describe('escapeHtml', () => {
  it('escapes the dangerous characters', () => {
    expect(escapeHtml('<script>"x"&\'')).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;');
  });
});

const stats = (o: Partial<ReportStats> = {}): ReportStats => ({
  window: { start: 'a', end: 'b', prevStart: 'c', prevEnd: 'd', label: '7 – 13 Jul 2026' },
  total: 12500,
  prevTotal: 10000,
  txnCount: 23,
  byCategory: [{ category: 'Food & Dining', count: 10, total: 8000 }, { category: 'Transport', count: 5, total: 4500 }],
  topMerchants: [{ merchant: 'SWIGGY', count: 6, total: 3200 }],
  ...o,
});

describe('fallbackInsights', () => {
  it('headline states the total and count; delta computed vs last week', () => {
    const ins = fallbackInsights(stats());
    expect(ins.headline).toContain('12,500');
    expect(ins.headline).toContain('23');
    expect(ins.insights.join(' ')).toContain('25% more'); // 12500 vs 10000
  });
  it('flags a large week-over-week jump as an anomaly', () => {
    const ins = fallbackInsights(stats({ total: 20000, prevTotal: 10000 }));
    expect(ins.anomalies.length).toBeGreaterThan(0);
  });
});

describe('renderReportHtml', () => {
  it('produces a self-contained doc with the total and no unescaped injection', () => {
    const s = stats({ topMerchants: [{ merchant: '<script>alert(1)</script>', count: 1, total: 500 }] });
    const html = renderReportHtml(s, fallbackInsights(s));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('₹12,500');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('▲ 25% vs last week');
  });
});
