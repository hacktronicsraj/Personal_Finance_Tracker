import type { Env } from './types';
import { categorySummary, topMerchants, listTxns, insertReport, type ReportRow } from './db';

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

const CATEGORY_COLOR: Record<string, string> = {
  'Food & Dining': '#F87171', Groceries: '#FBBF24', Transport: '#60A5FA', Shopping: '#C084FC',
  'Bills & Utilities': '#2DD4BF', Entertainment: '#F472B6', Health: '#34D399',
  Transfers: '#94A3B8', Income: '#34D399', Other: '#71717A',
};
const colorFor = (c: string) => CATEGORY_COLOR[c] ?? '#94A3B8';

/** Escape a string for safe interpolation into HTML text/attributes. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type ReportPeriod = 'weekly' | 'monthly';

export interface WeekWindow {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  label: string;
}

/**
 * The just-completed Mon–Sun week in IST, as UTC ISO bounds. Pure + testable.
 * The cron fires Sun 20:00 IST, so "this week" is the Mon..Sun ending that day.
 */
export function weekWindowIST(nowMs: number): WeekWindow {
  const ist = new Date(nowMs + IST_OFFSET); // UTC fields now read as IST wall-clock
  const daysFromMonday = (ist.getUTCDay() + 6) % 7; // 0=Sun → 6
  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const startUtc = istMidnight - daysFromMonday * 86400000 - IST_OFFSET;
  const endUtc = startUtc + 7 * 86400000 - 1;
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(ms));
  const year = new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(startUtc));
  return {
    start: new Date(startUtc).toISOString(),
    end: new Date(endUtc).toISOString(),
    prevStart: new Date(startUtc - 7 * 86400000).toISOString(),
    prevEnd: new Date(startUtc - 1).toISOString(),
    label: `${fmt(startUtc)} – ${fmt(endUtc)} ${year}`,
  };
}

/**
 * A calendar month in IST as UTC ISO bounds. `offset` months back from the
 * current IST month (0 = this month so far, 1 = last full month…). Pure.
 */
export function monthWindowIST(nowMs: number, offset = 0): WeekWindow {
  const ist = new Date(nowMs + IST_OFFSET);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() - offset;
  const startUtc = Date.UTC(y, m, 1) - IST_OFFSET;
  const endUtc = Date.UTC(y, m + 1, 1) - IST_OFFSET - 1;
  const prevStartUtc = Date.UTC(y, m - 1, 1) - IST_OFFSET;
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    .format(new Date(startUtc + IST_OFFSET));
  return {
    start: new Date(startUtc).toISOString(),
    end: new Date(endUtc).toISOString(),
    prevStart: new Date(prevStartUtc).toISOString(),
    prevEnd: new Date(startUtc - 1).toISOString(),
    label,
  };
}

export interface ReportStats {
  window: WeekWindow;
  total: number;
  prevTotal: number;
  txnCount: number;
  byCategory: { category: string; count: number; total: number }[];
  topMerchants: { merchant: string; count: number; total: number }[];
}

export interface ReportInsights {
  headline: string;
  insights: string[];
  anomalies: string[];
  narrative: string;
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** Gather the week's spending stats deterministically (no LLM). */
export async function buildReportStats(env: Env, window: WeekWindow): Promise<ReportStats> {
  const [byCategory, merchants, prev, txns] = await Promise.all([
    categorySummary(env, window.start, window.end),
    topMerchants(env, window.start, window.end, 5),
    categorySummary(env, window.prevStart, window.prevEnd),
    listTxns(env, { from: window.start, to: window.end, limit: 100000 }),
  ]);
  const total = byCategory.reduce((s, r) => s + (r.total ?? 0), 0);
  const prevTotal = prev.reduce((s, r) => s + (r.total ?? 0), 0);
  const debits = txns.filter((t) => t.direction === 'debit');
  return { window, total, prevTotal, txnCount: debits.length, byCategory, topMerchants: merchants };
}

/** Deterministic insights used when the LLM is unavailable — the report always
 * renders something useful even with no API key / a failed call. */
export function fallbackInsights(s: ReportStats, period: ReportPeriod = 'weekly'): ReportInsights {
  const noun = period === 'monthly' ? 'month' : 'week';
  const top = s.byCategory[0];
  const delta = s.prevTotal > 0 ? Math.round(((s.total - s.prevTotal) / s.prevTotal) * 100) : null;
  const insights: string[] = [];
  if (top) insights.push(`${top.category} was your biggest category at ${inr(top.total)}.`);
  if (s.topMerchants[0]) insights.push(`Most spent at ${s.topMerchants[0].merchant} (${inr(s.topMerchants[0].total)}).`);
  if (delta !== null) insights.push(`That's ${Math.abs(delta)}% ${delta >= 0 ? 'more' : 'less'} than the ${noun} before.`);
  const anomalies: string[] = [];
  if (delta !== null && delta >= 40) anomalies.push(`Spending jumped ${delta}% ${noun}-over-${noun}.`);
  return {
    headline: `You spent ${inr(s.total)} across ${s.txnCount} transactions`,
    insights,
    anomalies,
    narrative: '',
  };
}

/** Ask the LLM for a richer narrative; fall back to deterministic insights on any
 * failure or when no model is configured. Never throws. */
export async function generateInsights(env: Env, s: ReportStats, period: ReportPeriod = 'weekly'): Promise<ReportInsights> {
  const useLive = env.LLM_MODE !== 'mock' && !!env.LLM_API_KEY && !!env.LLM_BASE_URL;
  if (!useLive) return fallbackInsights(s, period);

  const model = env.LLM_REPORT_MODEL ?? env.LLM_MODEL ?? 'gemini-2.5-pro';
  const payload = {
    total: Math.round(s.total),
    previousWeekTotal: Math.round(s.prevTotal),
    transactionCount: s.txnCount,
    byCategory: s.byCategory.map((c) => ({ category: c.category, total: Math.round(c.total), count: c.count })),
    topMerchants: s.topMerchants.map((m) => ({ merchant: m.merchant, total: Math.round(m.total), count: m.count })),
  };
  const system = [
    'You are a concise personal-finance analyst. Given one week of spending stats (INR),',
    `write a short, friendly ${period} digest. Be specific with numbers; never invent data.`,
    'Return ONLY minified JSON:',
    '{"headline":<one punchy sentence with the total>,"insights":[<2-4 short bullet strings>],',
    '"anomalies":[<0-3 notable jumps/unusual items, else empty>],"narrative":<2-3 sentence summary>}.',
    'Do NOT include HTML or markdown — plain text only.',
  ].join('\n');

  const url = `${env.LLM_BASE_URL!.replace(/\/$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`report LLM ${res.status}`);
    const data: any = await res.json();
    const j = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
    const fb = fallbackInsights(s, period);
    return {
      headline: typeof j.headline === 'string' && j.headline ? j.headline : fb.headline,
      insights: Array.isArray(j.insights) ? j.insights.filter((x: unknown) => typeof x === 'string').slice(0, 4) : fb.insights,
      anomalies: Array.isArray(j.anomalies) ? j.anomalies.filter((x: unknown) => typeof x === 'string').slice(0, 3) : [],
      narrative: typeof j.narrative === 'string' ? j.narrative : '',
    };
  } catch {
    return fallbackInsights(s, period);
  } finally {
    clearTimeout(timer);
  }
}

/** Full pipeline: compute the period window, gather stats, enrich via LLM (with
 * fallback), render HTML, and persist. `offset` steps whole periods back
 * (monthly only; 0 = current month so far, 1 = last full month…). */
export async function generateReport(
  env: Env,
  nowMs: number,
  opts: { type?: ReportPeriod; offset?: number } = {},
): Promise<ReportRow> {
  const type: ReportPeriod = opts.type ?? 'weekly';
  const window = type === 'monthly' ? monthWindowIST(nowMs, opts.offset ?? 0) : weekWindowIST(nowMs);
  const stats = await buildReportStats(env, window);
  const insights = await generateInsights(env, stats, type);
  const html = renderReportHtml(stats, insights, type);
  const summary = {
    label: window.label,
    total: stats.total,
    prevTotal: stats.prevTotal,
    txnCount: stats.txnCount,
    insights,
  };
  return insertReport(
    env,
    { periodStart: window.start, periodEnd: window.end, summaryJson: JSON.stringify(summary), html, periodType: type },
    new Date(nowMs).toISOString(),
  );
}

/** Back-compat wrapper used by the weekly cron. */
export function generateWeeklyReport(env: Env, nowMs: number): Promise<ReportRow> {
  return generateReport(env, nowMs, { type: 'weekly' });
}

/** Inline SVG donut of the category breakdown. */
function donutSvg(byCategory: { category: string; total: number }[], total: number): string {
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = byCategory
    .filter((c) => c.total > 0)
    .map((c) => {
      const frac = total > 0 ? c.total / total : 0;
      const seg = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${colorFor(c.category)}" stroke-width="24"
        stroke-dasharray="${(frac * C).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-acc * C).toFixed(2)}" transform="rotate(-90 70 70)"/>`;
      acc += frac;
      return seg;
    })
    .join('');
  return `<svg width="140" height="140" viewBox="0 0 140 140">
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="#121214" stroke-width="24"/>${segs}
    <text x="70" y="66" text-anchor="middle" fill="#FAFAFA" font-size="17" font-weight="700">${escapeHtml(inr(total))}</text>
    <text x="70" y="84" text-anchor="middle" fill="#6B6B73" font-size="9" letter-spacing="1">SPENT</text>
  </svg>`;
}

/**
 * Render structured report data into a self-contained HTML document (Ink design
 * tokens, inline SVG). Pure — every dynamic string is HTML-escaped. The LLM never
 * emits HTML; we render it, which keeps output consistent and injection-safe.
 */
export function renderReportHtml(s: ReportStats, ins: ReportInsights, period: ReportPeriod = 'weekly'): string {
  const periodName = period === 'monthly' ? 'Monthly report' : 'Weekly report';
  const deltaNoun = period === 'monthly' ? 'month' : 'week';
  const delta = s.prevTotal > 0 ? Math.round(((s.total - s.prevTotal) / s.prevTotal) * 100) : null;
  const deltaChip =
    delta === null
      ? ''
      : `<span style="color:${delta >= 0 ? '#F87171' : '#34D399'};font-weight:600">
           ${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last ${deltaNoun}</span>`;

  const maxMerchant = s.topMerchants[0]?.total ?? 1;
  const legend = s.byCategory
    .slice(0, 6)
    .map((c) => {
      const pct = s.total > 0 ? Math.round((c.total / s.total) * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:8px;margin:5px 0">
        <span style="width:9px;height:9px;border-radius:3px;background:${colorFor(c.category)};display:inline-block"></span>
        <span style="color:#A1A1AA;font-size:13px;flex:1">${escapeHtml(c.category)}</span>
        <span style="color:#FAFAFA;font-size:13px;font-weight:700">${pct}%</span>
      </div>`;
    })
    .join('');

  const merchants = s.topMerchants
    .map((m) => {
      const w = Math.max(4, Math.round((m.total / maxMerchant) * 100));
      return `<div style="margin:9px 0">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <span style="color:#FAFAFA;font-size:13px">${escapeHtml(m.merchant)}</span>
          <span style="color:#A1A1AA;font-size:12px">${escapeHtml(inr(m.total))} · ${m.count}×</span>
        </div>
        <div style="height:5px;border-radius:3px;background:#121214;margin-top:4px;overflow:hidden">
          <div style="height:100%;width:${w}%;background:#34D399;border-radius:3px"></div>
        </div>
      </div>`;
    })
    .join('');

  const list = (items: string[], color: string) =>
    items.map((t) => `<li style="color:${color};margin:6px 0;font-size:14px;line-height:1.45">${escapeHtml(t)}</li>`).join('');

  const anomaliesBlock = ins.anomalies.length
    ? `<div style="margin-top:20px"><div style="color:#F59E0B;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Worth a look</div>
        <ul style="margin:0;padding-left:18px">${list(ins.anomalies, '#F8B4B4')}</ul></div>`
    : '';

  const narrativeBlock = ins.narrative
    ? `<p style="color:#A1A1AA;font-size:14px;line-height:1.55;margin-top:18px">${escapeHtml(ins.narrative)}</p>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${periodName} — ${escapeHtml(s.window.label)}</title></head>
<body style="margin:0;background:#000;color:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px">
  <div style="max-width:560px;margin:0 auto">
    <div style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#6B6B73;text-transform:uppercase">${periodName}</div>
    <div style="color:#A1A1AA;font-size:13px;margin-top:2px">${escapeHtml(s.window.label)}</div>
    <h1 style="font-size:22px;font-weight:800;letter-spacing:-0.5px;margin:14px 0 6px">${escapeHtml(ins.headline)}</h1>
    <div style="font-size:13px">${deltaChip}</div>

    <div style="background:#0A0A0C;border:1px solid #222226;border-radius:22px;padding:18px;margin-top:18px;display:flex;gap:16px;align-items:center">
      ${donutSvg(s.byCategory, s.total)}
      <div style="flex:1">${legend || '<span style="color:#6B6B73">No spending this week.</span>'}</div>
    </div>

    ${
      ins.insights.length
        ? `<div style="margin-top:20px"><div style="color:#A1A1AA;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">Highlights</div>
            <ul style="margin:0;padding-left:18px">${list(ins.insights, '#E4E4E7')}</ul></div>`
        : ''
    }
    ${anomaliesBlock}
    ${narrativeBlock}

    ${
      merchants
        ? `<div style="margin-top:22px"><div style="color:#A1A1AA;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Top merchants</div>${merchants}</div>`
        : ''
    }

    <div style="color:#444448;font-size:11px;margin-top:26px;font-family:monospace">Generated by Finance Tracker</div>
  </div>
</body></html>`;
}
