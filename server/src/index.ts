import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isCategory } from './categories';
import { classifyTxn, extractFromImage } from './llm';
import { normalizeMerchant } from './classify';
import { buildCsv } from './csv';
import { generateReport, generateWeeklyReport, type ReportPeriod } from './reports';
import {
  addCategory,
  categorySummary,
  changedSince,
  deleteTransaction,
  findByAlias,
  findByDedupe,
  findFuzzyMatch,
  insertTxn,
  listCategories,
  listTxns,
  makeDedupeKey,
  mergeTxn,
  recentFeedback,
  topMerchants,
  updateTransaction,
  getRuleByPattern,
  incrementRuleHit,
  processLearningLoop,
  listRules,
  upsertRule,
  deleteRule,
  updateRuleCategory,
  listMandates,
  getMandate,
  insertMandate,
  updateMandate,
  deleteMandate,
  findMandateMatch,
  linkMandate,
  tagAnalytics,
  insertAttachment,
  listAttachments,
  getAttachment,
  deleteAttachment,
  deleteAttachmentsForTxn,
  listReports,
  getReport,
  latestReport,
} from './db';
import type { ClassifyRequest, Env, FewShot } from './types';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Bearer-token auth. If API_TOKEN is unset (local dev), auth is open.
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next();
  const token = c.env.API_TOKEN;
  if (token) {
    const auth = c.req.header('authorization') ?? '';
    if (auth !== `Bearer ${token}`) return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

const now = () => new Date().toISOString();

app.get('/health', (c) => c.json({ ok: true, mode: c.env.LLM_MODE ?? 'live' }));

app.post('/classify', async (c) => {
  const body = (await c.req.json()) as ClassifyRequest;
  // rawText is optional: manual adds and shared screenshots have no source text.
  if (!body?.parsed || typeof body.parsed.amount !== 'number') {
    return c.json({ error: 'parsed.amount is required' }, 400);
  }

  const source = body.source ?? 'sms';
  const dedupeKey = body.dedupeKey ?? makeDedupeKey(body.deviceId, body.parsed);

  // 1) Exact match (same channel re-scan) or a prior merge of this exact event.
  const existing = (await findByDedupe(c.env, dedupeKey)) ?? (await findByAlias(c.env, dedupeKey));
  if (existing) return c.json({ transaction: existing, deduped: true });

  // 2) Same payment via a DIFFERENT channel within a short window → enrich, don't
  //    double-count. Bank SMS stays the record-of-truth; notifications enrich it.
  //    Deliberate MANUAL entries are exempt: the user explicitly typed them in, and
  //    merging one into a same-amount SMS txn silently swallows a real spend (e.g.
  //    a cash expense that happens to equal a recent debit).
  const nowIso = now();
  const sinceIso = new Date(Date.parse(nowIso) - 15 * 60 * 1000).toISOString();
  const fuzzy = source === 'manual' ? null : await findFuzzyMatch(c.env, {
    deviceId: body.deviceId,
    amount: body.parsed.amount,
    direction: body.parsed.direction,
    source,
    sinceIso,
  });
  if (fuzzy) {
    const merged = await mergeTxn(c.env, fuzzy, { source, parsed: body.parsed, dedupeKey }, nowIso);
    return c.json({ transaction: merged, deduped: true, merged: true });
  }

  // 3) New transaction. A user-chosen category (share/manual confirm) is stored
  //    directly and skips the LLM; otherwise classify.
  let cls;
  let corrected = 0;
  if (body.category && isCategory(body.category)) {
    cls = { category: body.category, merchant: body.parsed.merchant ?? '', confidence: 1, notes: 'manual' };
    corrected = 1;
  } else {
    const norm = body.parsed.merchant ? normalizeMerchant(body.parsed.merchant) : null;
    const rule = norm ? await getRuleByPattern(c.env, norm) : null;
    if (rule) {
      await incrementRuleHit(c.env, rule.id);
      cls = { category: rule.category, merchant: body.parsed.merchant ?? '', confidence: 1, notes: 'rule:merchant' };
    } else {
      const fewshot = (await recentFeedback(c.env)) as FewShot[];
      cls = await classifyTxn(c.env, { ...body.parsed, rawText: body.rawText }, fewshot);
    }
  }
  const row = await insertTxn(c.env, {
    deviceId: body.deviceId,
    dedupeKey,
    rawText: body.rawText ?? '',
    parsed: body.parsed,
    cls,
    now: nowIso,
    source,
    corrected,
    note: body.note,
    tags: body.tags,
  });

  // Auto-match new debits against active mandates
  let mandateMatch: { id: string; name: string; price_changed?: boolean } | undefined;
  if (row.direction === 'debit') {
    const txnDay = row.occurred_at
      ? new Date(row.occurred_at).getUTCDate()
      : new Date(nowIso).getUTCDate();
    const matched = await findMandateMatch(c.env, row.merchant, row.amount, txnDay);
    if (matched) {
      await linkMandate(c.env, row.id, matched.id, nowIso);
      row.mandate_id = matched.id;
      mandateMatch = { id: matched.id, name: matched.name };
      if (row.amount !== matched.amount) {
        mandateMatch.price_changed = true;
      }
    }
  }

  return c.json({ transaction: row, deduped: false, ...(mandateMatch ? { mandate: mandateMatch } : {}) });
});

// Vision extraction for a shared payment SCREENSHOT (Google Pay's share is an
// image). Returns the read-off fields only; the app shows a confirm screen and
// then POSTs /classify to save. Never persists here.
app.post('/extract-image', async (c) => {
  const body = (await c.req.json()) as { imageBase64?: string; mimeType?: string };
  if (!body?.imageBase64) return c.json({ error: 'imageBase64 required' }, 400);
  try {
    const extracted = await extractFromImage(c.env, body.imageBase64, body.mimeType);
    return c.json({ extracted });
  } catch (e: any) {
    // Model down / not configured — let the app fall back to manual entry.
    return c.json({ error: String(e?.message ?? e), extracted: null }, 200);
  }
});

app.get('/transactions', async (c) => {
  const num = (v: string | undefined) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const cats = c.req.query('categories');
  const rows = await listTxns(c.env, {
    from: c.req.query('from'),
    to: c.req.query('to'),
    category: c.req.query('category'),
    categories: cats ? cats.split(',').filter(Boolean) : undefined,
    search: c.req.query('q'),
    minAmount: num(c.req.query('minAmount')),
    maxAmount: num(c.req.query('maxAmount')),
    source: c.req.query('source'),
    tag: c.req.query('tag'),
    limit: num(c.req.query('limit')),
  });
  return c.json({ transactions: rows });
});

app.patch('/transactions/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as {
    category?: string;
    merchant?: string | null;
    amount?: number;
    note?: string | null;
    tags?: string[];
  };
  if (
    body.category === undefined &&
    body.merchant === undefined &&
    body.amount === undefined &&
    body.note === undefined &&
    body.tags === undefined
  ) {
    return c.json({ error: 'no editable fields provided' }, 400);
  }
  const nowIso = now();
  const row = await updateTransaction(c.env, id, body, nowIso);
  if (!row) return c.json({ error: 'not found' }, 404);
  if (body.category) {
    await processLearningLoop(c.env, row.merchant, body.category, nowIso);
  }
  return c.json({ transaction: row });
});

app.delete('/transactions/:id', async (c) => {
  const id = c.req.param('id');
  await deleteAttachmentsForTxn(c.env, id); // cascade: R2 objects + rows
  const ok = await deleteTransaction(c.env, id);
  if (!ok) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

/* ─────────────────────────── Attachments (M6) ─────────────────────────── */

// Decode a base64 payload (data-URI prefix tolerated) into bytes for R2.
function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

app.post('/transactions/:id/attachments', async (c) => {
  const txnId = c.req.param('id');
  const body = (await c.req.json()) as { base64?: string; mime?: string };
  if (!body?.base64) return c.json({ error: 'base64 required' }, 400);
  const bytes = decodeBase64(body.base64);
  const attId = crypto.randomUUID();
  const r2Key = `txn/${txnId}/${attId}`;
  await c.env.ATTACHMENTS.put(r2Key, bytes, {
    httpMetadata: { contentType: body.mime ?? 'application/octet-stream' },
  });
  const att = await insertAttachment(
    c.env,
    { txnId, r2Key, mime: body.mime ?? null, size: bytes.byteLength },
    now(),
  );
  return c.json({ attachment: att }, 201);
});

app.get('/transactions/:id/attachments', async (c) =>
  c.json({ attachments: await listAttachments(c.env, c.req.param('id')) }),
);

app.get('/attachments/:id', async (c) => {
  const att = await getAttachment(c.env, c.req.param('id'));
  if (!att) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.ATTACHMENTS.get(att.r2_key);
  if (!obj) return c.json({ error: 'object missing' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': att.mime ?? 'application/octet-stream',
      'cache-control': 'private, max-age=31536000',
    },
  });
});

app.delete('/attachments/:id', async (c) => {
  const row = await deleteAttachment(c.env, c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

app.get('/analytics/summary', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const [byCategory, merchants] = await Promise.all([
    categorySummary(c.env, from, to),
    topMerchants(c.env, from, to),
  ]);
  const totalSpent = byCategory.reduce((s, r) => s + (r.total ?? 0), 0);
  return c.json({ totalSpent, byCategory, topMerchants: merchants });
});

app.get('/analytics/tags', async (c) => {
  const tags = await tagAnalytics(c.env, c.req.query('from'), c.req.query('to'));
  return c.json({ tags });
});

// CSV export (M5). Streams all matching transactions as a downloadable file;
// doubles as a backup. Range-filterable via ?from=&to=.
app.get('/export', async (c) => {
  const rows = await listTxns(c.env, {
    from: c.req.query('from'),
    to: c.req.query('to'),
    limit: 1_000_000, // export is uncapped, unlike the paged list
  });
  const csv = buildCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="transactions-${stamp}.csv"`,
    },
  });
});

app.get('/categories', async (c) => c.json({ categories: await listCategories(c.env) }));

app.post('/categories', async (c) => {
  const { name, icon, color } = (await c.req.json()) as { name: string; icon?: string; color?: string };
  if (!name) return c.json({ error: 'name required' }, 400);
  return c.json({ category: await addCategory(c.env, name, icon, color) });
});

app.get('/sync', async (c) => {
  const cursor = c.req.query('since') ?? '1970-01-01T00:00:00.000Z';
  const rows = await changedSince(c.env, cursor);
  const nextCursor = rows.length ? rows[rows.length - 1].updated_at : cursor;
  return c.json({ transactions: rows, nextCursor });
});

app.get('/rules', async (c) => c.json({ rules: await listRules(c.env) }));

app.post('/rules', async (c) => {
  const { pattern, category } = (await c.req.json()) as { pattern: string; category: string };
  if (!pattern || !category) return c.json({ error: 'pattern and category required' }, 400);
  const norm = normalizeMerchant(pattern);
  if (!norm) return c.json({ error: 'invalid pattern' }, 400);
  await upsertRule(c.env, norm, category, 'manual', now());
  return c.json({ ok: true });
});

app.patch('/rules/:id', async (c) => {
  const { category } = (await c.req.json()) as { category: string };
  if (!category) return c.json({ error: 'category required' }, 400);
  await updateRuleCategory(c.env, c.req.param('id'), category, now());
  return c.json({ ok: true });
});

app.delete('/rules/:id', async (c) => {
  await deleteRule(c.env, c.req.param('id'));
  return c.json({ ok: true });
});

/* ─────────────────────────── Mandates ─────────────────────────── */

app.get('/mandates', async (c) => c.json({ mandates: await listMandates(c.env) }));

app.post('/mandates', async (c) => {
  const body = (await c.req.json()) as {
    name?: string;
    platform?: string;
    amount?: number;
    day_of_cycle?: number;
    frequency?: string;
    category?: string;
    merchant_hint?: string;
    notes?: string;
  };
  if (!body?.name || !body?.platform || typeof body?.amount !== 'number' || typeof body?.day_of_cycle !== 'number') {
    return c.json({ error: 'name, platform, amount, and day_of_cycle are required' }, 400);
  }
  const mandate = await insertMandate(c.env, body as any, now());
  return c.json({ mandate }, 201);
});

app.patch('/mandates/:id', async (c) => {
  const id = c.req.param('id');
  const body = (await c.req.json()) as Record<string, unknown>;
  const mandate = await updateMandate(c.env, id, body as any, now());
  if (!mandate) return c.json({ error: 'not found' }, 404);
  return c.json({ mandate });
});

app.delete('/mandates/:id', async (c) => {
  const ok = await deleteMandate(c.env, c.req.param('id'));
  if (!ok) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

/* ─────────────────────────── Reports (M7) ─────────────────────────── */

app.get('/reports', async (c) => c.json({ reports: await listReports(c.env) }));

app.get('/reports/latest', async (c) => {
  const r = await latestReport(c.env);
  if (!r?.html) return c.json({ error: 'no report yet' }, 404);
  return c.html(r.html);
});

app.get('/reports/:id', async (c) => {
  const r = await getReport(c.env, c.req.param('id'));
  if (!r?.html) return c.json({ error: 'not found' }, 404);
  return c.html(r.html);
});

// Manual generation — powers the app's retry state, on-demand monthly reports,
// and past-month backfills. Body: { type?: 'weekly'|'monthly', offset?: number }
// where offset counts whole months back (monthly only; 0 = this month so far).
app.post('/reports/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { type?: string; offset?: number };
  const type: ReportPeriod = body.type === 'monthly' ? 'monthly' : 'weekly';
  const offset = Number.isInteger(body.offset) && body.offset! >= 0 && body.offset! <= 24 ? body.offset : 0;
  const r = await generateReport(c.env, Date.now(), { type, offset });
  return c.json(
    { report: { id: r.id, period_start: r.period_start, period_end: r.period_end, period_type: r.period_type, created_at: r.created_at } },
    201,
  );
});

// Worker entry: HTTP via Hono, plus crons — weekly digest (Sun 20:00 IST) and
// monthly digest (00:00 IST on the 1st, covering the just-ended month).
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const monthly = event.cron.includes(' L ');
    ctx.waitUntil(
      (monthly
        ? generateReport(env, Date.now(), { type: 'monthly', offset: 1 })
        : generateWeeklyReport(env, Date.now())
      ).then(() => undefined),
    );
  },
};
