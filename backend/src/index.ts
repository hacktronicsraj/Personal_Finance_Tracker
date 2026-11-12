import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  alreadyImported, countFlashcards, getFlashcards, insertFlashcards, insertFlashcardsBulk, listDecks,
  pickQuiz, recordQuizResults,
} from './assistantDb';
import { parseFlashcardCsv } from './csvParse';
import { uploadPage } from './uploadPage';
import { isIgnoredPayee, ruleClassify } from './classify';
import {
  analyticsSummary, clearAlias, createCategory, deleteTransaction, getTransaction,
  insertTransaction, learnFromCorrection, listAliases, listCategories, listTransactions,
  lookupMerchantRule, patchTransaction, setAlias, syncSince,
} from './db';
import { extractShareText, fetchShareConversation, generateFlashcards } from './flashcards';
import { llmJson } from './llm';
import { parseStatement, reconcile, type LedgerTxn } from './statements';
import { applyStatement, createStatement, getStatement, listStatements } from './statementsDb';
import { addDays, istDay } from './ist';
import type { Classification, Env, ParsedTxn } from './types';

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

/**
 * The browser upload page is exempt from bearer auth — a browser can't set an
 * Authorization header on a navigation. It authenticates with UPLOAD_PASSWORD
 * on POST /upload/bulk instead, and never sees API_TOKEN.
 */
const BROWSER_PATHS = new Set(['/upload', '/upload/bulk']);

/** Bearer-token auth on everything except /health and the browser upload paths.
 * No token set = open (local dev). */
app.use('*', async (c, next) => {
  if (c.req.path === '/health' || BROWSER_PATHS.has(c.req.path)) return next();
  const expected = c.env.API_TOKEN;
  if (expected) {
    const got = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
    if (got !== expected) return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
});

/** Constant-time-ish string compare — avoids leaking length/prefix via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

app.get('/health', (c) =>
  c.json({ ok: true, service: 'pft-native', time: new Date().toISOString() }));

/* ─────────────────────── Browser upload page ─────────────────────── */

app.get('/upload', (c) => c.html(uploadPage));

/**
 * CSV upload from the browser page. Auth is UPLOAD_PASSWORD (not the API token),
 * because the page has no way to hold a bearer token. If UPLOAD_PASSWORD is
 * unset the endpoint is closed rather than open — unlike API_TOKEN, a missing
 * upload password must never mean "anyone can write to the deck".
 */
app.post('/upload/bulk', async (c) => {
  const expected = c.env.UPLOAD_PASSWORD;
  if (!expected) return c.json({ error: 'upload is not configured' }, 503);

  const body = await c.req.json<{ password?: string; csv?: string; deck?: string; source?: string }>()
    .catch(() => ({} as any));
  if (!body.password || !safeEqual(String(body.password), expected)) {
    return c.json({ error: 'wrong password' }, 401);
  }

  const csv = typeof body.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return c.json({ error: 'no file content' }, 400);
  if (csv.length > 2_000_000) return c.json({ error: 'file too large (max ~2MB)' }, 413);

  const deck = (body.deck ?? '').trim() || 'default';
  const { cards, errors, headerSkipped } = parseFlashcardCsv(csv);
  if (!cards.length) return c.json({ error: 'no valid cards found', errors, headerSkipped }, 422);

  const source = (body.source ?? '').trim() || `web:${deck}`;
  const res = await insertFlashcardsBulk(c.env, cards, deck, source);
  return c.json({
    ...res,
    parsed: cards.length,
    errors,
    headerSkipped,
    total: await countFlashcards(c.env, deck),
  }, 201);
});

/**
 * Classify + store a captured payment. Finance is debit-only: credits and ignored
 * payees (Groww) are dropped. A user-supplied `category` skips classification.
 * Priority: user category → learned merchant rule → deterministic rules.
 */
app.post('/classify', async (c) => {
  const body = await c.req.json<{
    deviceId?: string; rawText?: string; dedupeKey?: string; parsed: ParsedTxn;
    source?: string; category?: string; note?: string; tags?: string[];
  }>();
  const parsed = body.parsed;
  if (!parsed || typeof parsed.amount !== 'number') return c.json({ error: 'parsed.amount required' }, 400);
  parsed.rawText = parsed.rawText ?? body.rawText ?? '';

  if (parsed.direction === 'credit') return c.json({ ignored: 'credit' });
  if (isIgnoredPayee(parsed.merchant, parsed.rawText)) return c.json({ ignored: 'groww' });

  let cls: Classification;
  if (body.category) {
    cls = { category: body.category as any, merchant: parsed.merchant ?? '', confidence: 1, notes: 'user' };
  } else {
    const learned = parsed.merchant ? await lookupMerchantRule(c.env, parsed.merchant) : null;
    cls = learned
      ? { category: learned as any, merchant: parsed.merchant ?? '', confidence: 0.85, notes: 'rule:learned' }
      : ruleClassify(parsed);
  }

  const { txn, deduped } = await insertTransaction(c.env, parsed, cls, {
    deviceId: body.deviceId, dedupeKey: body.dedupeKey, source: body.source ?? 'sms',
    userNote: body.note, tags: body.tags,
  });
  return c.json({ transaction: txn, deduped });
});

app.get('/transactions', async (c) => {
  const q = c.req.query();
  const txns = await listTransactions(c.env, {
    from: q.from, to: q.to, category: q.category, q: q.q,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  return c.json({ transactions: txns });
});

app.get('/transactions/:id', async (c) => {
  const txn = await getTransaction(c.env, c.req.param('id'));
  return txn ? c.json({ transaction: txn }) : c.json({ error: 'not found' }, 404);
});

/** Manually log a spend. Defaults to a debit today. */
app.post('/transactions', async (c) => {
  const body = await c.req.json<{
    amount: number; merchant?: string; category?: string; occurredAt?: string;
    note?: string; tags?: string[]; direction?: 'debit' | 'credit'; rawText?: string;
  }>();
  if (typeof body.amount !== 'number') return c.json({ error: 'amount required' }, 400);
  const parsed: ParsedTxn = {
    amount: body.amount,
    direction: body.direction ?? 'debit',
    currency: 'INR',
    merchant: body.merchant ?? null,
    occurredAt: body.occurredAt ?? new Date().toISOString(),
    rawText: body.rawText ?? `Manual: ${body.merchant ?? 'spend'} ${body.amount}`,
  };
  const cls: Classification = body.category
    ? { category: body.category as any, merchant: body.merchant ?? '', confidence: 1, notes: 'user' }
    : ruleClassify(parsed);
  const { txn } = await insertTransaction(c.env, parsed, cls, {
    source: 'manual', userNote: body.note, tags: body.tags,
  });
  return c.json({ transaction: txn });
});

app.patch('/transactions/:id', async (c) => {
  const id = c.req.param('id');
  const before = await getTransaction(c.env, id);
  if (!before) return c.json({ error: 'not found' }, 404);
  const fields = await c.req.json<{
    category?: string; merchant?: string | null; amount?: number; note?: string | null; tags?: string[];
  }>();
  const txn = await patchTransaction(c.env, id, {
    category: fields.category, merchant: fields.merchant, amount: fields.amount,
    user_note: fields.note, tags: fields.tags,
  });
  // Learn from a category correction so the payee classifies right next time.
  if (fields.category && fields.category !== before.category) {
    await learnFromCorrection(c.env, before, fields.category).catch(() => {});
  }
  return c.json({ transaction: txn });
});

app.delete('/transactions/:id', async (c) => {
  await deleteTransaction(c.env, c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/analytics/summary', async (c) => {
  const q = c.req.query();
  return c.json(await analyticsSummary(c.env, q.from, q.to));
});

app.get('/categories', async (c) => c.json({ categories: await listCategories(c.env) }));
app.post('/categories', async (c) => {
  const b = await c.req.json<{ name: string; color?: string; icon?: string }>();
  if (!b.name) return c.json({ error: 'name required' }, 400);
  return c.json({ category: await createCategory(c.env, b.name, b.color, b.icon) });
});

app.get('/aliases', async (c) => c.json({ aliases: await listAliases(c.env) }));
app.post('/aliases', async (c) => {
  const b = await c.req.json<{ merchant: string; displayName: string }>();
  if (!b.merchant || !b.displayName) return c.json({ error: 'merchant and displayName required' }, 400);
  return c.json({ patterns: await setAlias(c.env, b.merchant, b.displayName) });
});
app.delete('/aliases/:pattern', async (c) => {
  await clearAlias(c.env, decodeURIComponent(c.req.param('pattern')));
  return c.json({ ok: true });
});

app.get('/sync', async (c) => {
  const since = c.req.query('since') ?? '1970-01-01T00:00:00.000Z';
  return c.json(await syncSince(c.env, since));
});

/* ─────────────────────────── Flashcards (Instagram gate) ─────────────────────────── */

/** Import a ChatGPT share into flashcards. The phone fetches the HTML (Worker
 * egress to chatgpt.com is blocked) and posts it as `html`; server-fetch is a fallback. */
app.post('/flashcards/import', async (c) => {
  const body = await c.req.json<{ url: string; topic?: string; html?: string; deck?: string }>();
  if (!body.url) return c.json({ error: 'url required' }, 400);
  if (await alreadyImported(c.env, body.url)) {
    return c.json({ added: 0, total: await countFlashcards(c.env), alreadyImported: true });
  }
  let text: string;
  let title: string | null = null;
  if (body.html) {
    text = extractShareText(body.html);
    title = body.html.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/\s*[-–|]\s*ChatGPT.*$/i, '').trim() || null;
  } else {
    const conv = await fetchShareConversation(body.url);
    text = conv.text;
    title = conv.title;
  }
  if (!text || text.length < 200) return c.json({ error: 'no readable content in that conversation' }, 400);
  const cards = await generateFlashcards(c.env, text, body.topic ?? 'inference engineering', 12);
  const deck = (body.deck ?? '').trim() || 'default';
  const added = await insertFlashcards(c.env, cards, body.url, title, deck);
  return c.json({ added, total: await countFlashcards(c.env), title, deck });
});

app.get('/flashcards/count', async (c) => c.json({ count: await countFlashcards(c.env, c.req.query('deck')) }));

/**
 * Bulk import from CSV.
 *
 * Body: { csv: string, deck?: string, source?: string }
 * CSV columns: question,option1,option2,option3,option4,answer[,difficulty]
 * `answer` is the 0-based index of the correct option. A header row is detected
 * and skipped automatically. RFC-4180 quoting is supported (commas/quotes/newlines
 * inside quoted fields).
 *
 * Returns per-row errors rather than failing the whole file, so one bad line
 * doesn't cost you the other 200 cards.
 */
app.post('/flashcards/bulk', async (c) => {
  const body = await c.req.json<{ csv?: string; deck?: string; source?: string }>().catch(() => ({} as any));
  const csv = typeof body.csv === 'string' ? body.csv : '';
  if (!csv.trim()) return c.json({ error: 'csv required' }, 400);
  // Guard the request size — a huge body is more likely a mistake than intent.
  if (csv.length > 2_000_000) return c.json({ error: 'file too large (max ~2MB)' }, 413);

  const deck = (body.deck ?? '').trim() || 'default';
  const { cards, errors, headerSkipped } = parseFlashcardCsv(csv);
  if (!cards.length) {
    return c.json({ error: 'no valid cards found', errors, headerSkipped }, 422);
  }

  const source = (body.source ?? '').trim() || `csv:${deck}`;
  const res = await insertFlashcardsBulk(c.env, cards, deck, source);
  return c.json({
    ...res,
    parsed: cards.length,
    errors,
    headerSkipped,
    total: await countFlashcards(c.env, deck),
  }, 201);
});

/** Decks in the library with live card counts (suspended cards excluded). */
app.get('/flashcards/decks', async (c) => c.json({ decks: await listDecks(c.env) }));

/**
 * N cards for the gate. Answers are withheld so they can't be read off the wire;
 * grade via POST /flashcards/grade.
 *
 * Query: n, deck, spacing (hours a card stays out of rotation), checkpoint (the
 * gate's checkpoint index today — recorded with the grade for daily stats).
 */
app.get('/flashcards/quiz', async (c) => {
  const n = Math.min(Math.max(Number(c.req.query('n')) || 5, 1), 20);
  const deck = c.req.query('deck') || null;
  const spacing = Number(c.req.query('spacing'));
  const cards = await pickQuiz(c.env, n, {
    deck,
    spacingHours: Number.isFinite(spacing) && spacing >= 0 ? spacing : undefined,
  });
  return c.json({
    count: await countFlashcards(c.env, deck),
    deck,
    cards: cards.map((f) => ({ id: f.id, question: f.question, options: JSON.parse(f.options), difficulty: f.difficulty })),
  });
});

/**
 * Grade a round. Body: { answers: { [cardId]: chosenIndex }, checkpoint? }.
 * `passed` means every answered card was correct — the gate keeps re-showing the
 * misses until a round comes back fully correct.
 */
app.post('/flashcards/grade', async (c) => {
  const body = await c.req.json<{ answers?: Record<string, number>; checkpoint?: number; deck?: string }>();
  const answers = body.answers ?? {};
  const ids = Object.keys(answers);
  if (!ids.length) return c.json({ error: 'answers required' }, 400);
  const cards = await getFlashcards(c.env, ids);
  const results = cards.map((f) => ({ id: f.id, correct: answers[f.id] === f.answer, answer: f.answer }));
  // Only log attempts when the caller says which checkpoint this belongs to —
  // a stray quiz from the library screen shouldn't skew the daily stats.
  const checkpoint = Number.isInteger(body.checkpoint) ? body.checkpoint : null;
  await recordQuizResults(c.env, results, checkpoint != null ? istDay(Date.now()) : null, checkpoint);
  const correct = results.filter((r) => r.correct).length;
  return c.json({
    passed: correct === cards.length && cards.length > 0,
    correct,
    total: cards.length,
    results: results.map((r) => ({ id: r.id, correct: r.correct, answer: r.answer })),
  });
});

/** Suspend / restore a card without deleting it (it just leaves the rotation). */
app.patch('/flashcards/:id', async (c) => {
  const body = await c.req.json<{ suspended?: boolean; deck?: string }>().catch(() => ({} as any));
  const id = c.req.param('id');
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.suspended === 'boolean') {
    sets.push('suspended = ?');
    binds.push(body.suspended ? 1 : 0);
  }
  if (typeof body.deck === 'string' && body.deck.trim()) {
    sets.push('deck = ?');
    binds.push(body.deck.trim());
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  const res = await c.env.DB.prepare(`UPDATE flashcards SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

/** Per-day attempt stats for the last `days` IST days (gate progress screen). */
app.get('/flashcards/stats', async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days')) || 14, 1), 90);
  const since = addDays(istDay(Date.now()), -(days - 1));
  const res = await c.env.DB.prepare(
    `SELECT day,
            COUNT(DISTINCT checkpoint) AS checkpoints,
            COUNT(*)                   AS attempts,
            SUM(correct)               AS correct
       FROM flashcard_attempts
      WHERE day >= ?
      GROUP BY day
      ORDER BY day DESC`,
  ).bind(since).all<{ day: string; checkpoints: number; attempts: number; correct: number }>();
  return c.json({ stats: res.results ?? [] });
});

/* ─────────────────────────── Ask your money ─────────────────────────── */

/** A grounded chat over the ledger. Pulls recent spend + this month's summary as
 * context and lets the LLM answer questions like "how much on food this month?". */
app.post('/ask', async (c) => {
  const body = await c.req.json<{ question: string }>();
  const q = (body.question || '').trim();
  if (!q) return c.json({ error: 'question required' }, 400);

  const monthStart = new Date(Date.now() + 5.5 * 3600_000);
  monthStart.setUTCDate(1);
  const fromIso = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1) - 5.5 * 3600_000).toISOString();
  const [summary, recent] = await Promise.all([
    analyticsSummary(c.env, fromIso),
    listTransactions(c.env, { limit: 60 }),
  ]);
  const ctx = {
    today: new Date().toISOString().slice(0, 10),
    thisMonthTotalSpent: Math.round(summary.totalSpent),
    byCategory: summary.byCategory.map((x) => ({ category: x.category, total: Math.round(x.total), count: x.count })),
    topMerchants: summary.topMerchants.slice(0, 8).map((x) => ({ merchant: x.merchant, total: Math.round(x.total), count: x.count })),
    recent: recent.slice(0, 40).map((t) => ({
      date: (t.occurred_at ?? t.created_at).slice(0, 10), merchant: t.merchant, amount: Math.round(t.amount), category: t.category,
    })),
  };
  try {
    const answer = await llmJson<string>(
      c.env,
      [
        {
          role: 'system',
          content:
            'You are a personal finance assistant. Answer the user\'s question ONLY from the JSON ledger context provided. ' +
            'All amounts are INR (₹). Be concise and specific, use ₹ and Indian number formatting. If the data does not contain ' +
            'the answer, say so plainly. Do not invent transactions.',
        },
        { role: 'user', content: `Ledger context:\n${JSON.stringify(ctx)}\n\nQuestion: ${q}` },
      ],
      { json: false, timeoutMs: 20000, temperature: 0.2 },
    );
    return c.json({ answer: String(answer).trim() });
  } catch {
    return c.json({ answer: "I couldn't reach the assistant model just now. Try again in a moment." });
  }
});

/* ─────────────────────────── Bank-statement reconciliation ─────────────────────────── */

/** Reconcile an uploaded statement. The phone extracts the PDF text on-device and
 * posts { pages: string[] } (and/or page images). Returns the proposed diff. */
app.post('/statements', async (c) => {
  const body = await c.req.json<{ pages?: string[]; images?: string[] }>();
  if (!body.pages?.length && !body.images?.length) return c.json({ error: 'pages or images required' }, 400);

  const parsed = await parseStatement(c.env, { pages: body.pages, images: body.images });

  // Ledger debits that could line up with this statement (period ± 3 days).
  const from = `${addDays(parsed.periodStart, -3)}T00:00:00.000Z`;
  const to = `${addDays(parsed.periodEnd, 3)}T23:59:59.999Z`;
  const res = await c.env.DB.prepare(
    `SELECT id, amount, direction, occurred_at, created_at, merchant, raw_text, ref_no, source, account_tail, category
     FROM transactions WHERE direction = 'debit' AND COALESCE(occurred_at, created_at) >= ? AND COALESCE(occurred_at, created_at) <= ?`,
  ).bind(from, to).all<LedgerTxn>();
  const ledger = res.results ?? [];

  const recon = reconcile(parsed, ledger);
  const id = await createStatement(c.env, parsed, recon);
  return c.json({
    id,
    bank: parsed.bank,
    accountTail: parsed.accountTail,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    parser: parsed.parser,
    rowCount: parsed.rows.length,
    balanceCheck: parsed.balanceCheck,
    matched: recon.matches.length,
    adds: recon.adds.length,
    removes: recon.removes.length,
    creditsIgnored: recon.creditsIgnored,
  });
});

app.get('/statements', async (c) => c.json({ statements: await listStatements(c.env) }));

app.get('/statements/:id', async (c) => {
  const s = await getStatement(c.env, c.req.param('id'));
  return s ? c.json(s) : c.json({ error: 'not found' }, 404);
});

/** Apply approved proposals. Body: { decisions: { [itemId]: "approve" | "deny" } }.
 * Omitted items use their stored suggestion. Resumable + idempotent. */
app.post('/statements/:id/apply', async (c) => {
  const body = await c.req.json<{ decisions?: Record<string, 'approve' | 'deny'> }>().catch(() => ({ decisions: {} }));
  const result = await applyStatement(c.env, c.req.param('id'), body.decisions ?? {});
  return c.json(result);
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error('unhandled', err);
  return c.json({ error: 'internal', detail: String(err?.message ?? err) }, 500);
});

export default app;
