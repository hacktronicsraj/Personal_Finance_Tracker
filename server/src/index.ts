import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { isCategory } from './categories';
import { classifyTxn, extractFromImage } from './llm';
import {
  addCategory,
  categorySummary,
  changedSince,
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
  updateCategory,
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
  if (!body?.rawText || !body?.parsed || typeof body.parsed.amount !== 'number') {
    return c.json({ error: 'rawText and parsed.amount are required' }, 400);
  }

  const source = body.source ?? 'sms';
  const dedupeKey = body.dedupeKey ?? makeDedupeKey(body.deviceId, body.parsed);

  // 1) Exact match (same channel re-scan) or a prior merge of this exact event.
  const existing = (await findByDedupe(c.env, dedupeKey)) ?? (await findByAlias(c.env, dedupeKey));
  if (existing) return c.json({ transaction: existing, deduped: true });

  // 2) Same payment via a DIFFERENT channel within a short window → enrich, don't
  //    double-count. Bank SMS stays the record-of-truth; notifications enrich it.
  const nowIso = now();
  const sinceIso = new Date(Date.parse(nowIso) - 15 * 60 * 1000).toISOString();
  const fuzzy = await findFuzzyMatch(c.env, {
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
    const fewshot = (await recentFeedback(c.env)) as FewShot[];
    cls = await classifyTxn(c.env, { ...body.parsed, rawText: body.rawText }, fewshot);
  }
  const row = await insertTxn(c.env, {
    deviceId: body.deviceId,
    dedupeKey,
    rawText: body.rawText,
    parsed: body.parsed,
    cls,
    now: nowIso,
    source,
    corrected,
  });
  return c.json({ transaction: row, deduped: false });
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
  const rows = await listTxns(c.env, {
    from: c.req.query('from'),
    to: c.req.query('to'),
    category: c.req.query('category'),
    search: c.req.query('q'),
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
  });
  return c.json({ transactions: rows });
});

app.patch('/transactions/:id', async (c) => {
  const id = c.req.param('id');
  const { category } = (await c.req.json()) as { category: string };
  if (!category) return c.json({ error: 'category required' }, 400);
  const row = await updateCategory(c.env, id, category, now());
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ transaction: row });
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

export default app;
