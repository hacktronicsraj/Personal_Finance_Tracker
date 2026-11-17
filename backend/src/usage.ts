import { Hono } from 'hono';
import { addDays, istDay, istMidnightUtc } from './ist';
import type { Env } from './types';

/**
 * App usage history (Instagram, for the focus gate).
 *
 * Android keeps raw open/close events for only about a week, so the phone
 * turns them into sessions and uploads them here, where they're kept. A
 * session is keyed by app + start time, so re-sending is harmless and a
 * session still open at the last upload is just extended next time.
 *
 * Days are IST. A session that crosses midnight is split between the two
 * days for minutes; it counts as one "open", on the day it started.
 */

interface SessionRow { pkg: string; start_ms: number; end_ms: number }

const DAY_MS = 86_400_000;
const MAX_SESSION_MS = 24 * 3_600_000;

export function registerUsageRoutes(app: Hono<{ Bindings: Env }>) {
  app.post('/usage/sessions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sessions?: { pkg?: string; startMs?: number; endMs?: number }[];
    };
    const now = Date.now();
    const valid = (body.sessions ?? []).filter(
      (s) => typeof s.pkg === 'string' && s.pkg && Number.isFinite(s.startMs) && Number.isFinite(s.endMs)
        && s.endMs! > s.startMs! && s.endMs! - s.startMs! <= MAX_SESSION_MS && s.endMs! <= now + 60_000,
    );
    if (valid.length) {
      const stmt = c.env.DB.prepare(
        `INSERT INTO app_sessions (id, pkg, start_ms, end_ms, day, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET end_ms = MAX(app_sessions.end_ms, excluded.end_ms), updated_at = excluded.updated_at`,
      );
      const at = new Date().toISOString();
      const rows = valid.map((s) =>
        stmt.bind(`${s.pkg}:${s.startMs}`, s.pkg, s.startMs, s.endMs, istDay(s.startMs!), at));
      for (let i = 0; i < rows.length; i += 50) await c.env.DB.batch(rows.slice(i, i + 50));
    }
    return c.json({ stored: valid.length, skipped: (body.sessions?.length ?? 0) - valid.length });
  });

  /** Per-day totals for the last `days` IST days (oldest first, empty days included). */
  app.get('/usage/days', async (c) => {
    const pkg = c.req.query('pkg') || 'com.instagram.android';
    const days = Math.min(Math.max(Number(c.req.query('days') ?? 30) || 30, 1), 365);
    const today = istDay(Date.now());
    const firstDay = addDays(today, -(days - 1));
    const from = istMidnightUtc(firstDay);
    const rows = await sessionsBetween(c.env, pkg, from, istMidnightUtc(today) + DAY_MS);
    return c.json({ pkg, days: dailyTotals(rows, firstDay, days) });
  });

  /** Every session that touched one IST day, in order, clipped to that day. */
  app.get('/usage/sessions', async (c) => {
    const pkg = c.req.query('pkg') || 'com.instagram.android';
    const day = c.req.query('day') || istDay(Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return c.json({ error: 'day must be YYYY-MM-DD' }, 400);
    const start = istMidnightUtc(day);
    const rows = await sessionsBetween(c.env, pkg, start, start + DAY_MS);
    return c.json({
      pkg,
      day,
      sessions: rows.map((r) => {
        const s = Math.max(r.start_ms, start);
        const e = Math.min(r.end_ms, start + DAY_MS);
        return { startMs: r.start_ms, endMs: r.end_ms, minutes: round1((e - s) / 60_000), continued: r.start_ms < start };
      }),
    });
  });
}

async function sessionsBetween(env: Env, pkg: string, from: number, to: number): Promise<SessionRow[]> {
  const res = await env.DB.prepare(
    `SELECT pkg, start_ms, end_ms FROM app_sessions
     WHERE pkg = ? AND end_ms > ? AND start_ms < ? ORDER BY start_ms`,
  )
    .bind(pkg, from, to)
    .all<SessionRow>();
  return res.results ?? [];
}

export interface DayTotal {
  day: string;
  minutes: number;
  opens: number;
  longestMinutes: number;
  firstOpenMs: number | null;
  lastCloseMs: number | null;
}

/** Splits sessions across IST days and totals each day. Exported for tests. */
export function dailyTotals(rows: SessionRow[], firstDay: string, days: number): DayTotal[] {
  const out: DayTotal[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(firstDay, i);
    const start = istMidnightUtc(day);
    const end = start + DAY_MS;
    let ms = 0, opens = 0, longest = 0;
    let first: number | null = null, last: number | null = null;
    for (const r of rows) {
      const s = Math.max(r.start_ms, start);
      const e = Math.min(r.end_ms, end);
      if (e <= s) continue;
      ms += e - s;
      longest = Math.max(longest, e - s);
      if (r.start_ms >= start && r.start_ms < end) {
        opens++;
        if (first === null || r.start_ms < first) first = r.start_ms;
      }
      if (last === null || e > last) last = e;
    }
    out.push({
      day, minutes: round1(ms / 60_000), opens, longestMinutes: round1(longest / 60_000),
      firstOpenMs: first, lastCloseMs: last,
    });
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
