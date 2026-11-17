import type { Hono } from 'hono';
import { coachReply, countWords, validateCheckin, verifyBlanket } from './assistant';
import {
  acceptedCheckin,
  addMessage,
  getStatement,
  insertCheckin,
  insertFocusEvent,
  insertStatement,
  learningThread,
  listCheckins,
  listFocusEvents,
  listMessages,
  listStatements,
  markStatementApplied,
  setItemDecision,
  type StatementItemDb,
  insertFlashcards,
  countFlashcards,
  alreadyImported,
  pickQuiz,
  getFlashcards,
  recordQuizResults,
} from './assistantDb';
import { fetchShareConversation, generateFlashcards, extractShareText } from './flashcards';
import { isCategory } from './categories';
import { normalizeMerchant } from './classify';
import {
  deleteAttachmentsForTxn,
  deleteTransaction,
  findByDedupe,
  findMandateMatch,
  findRuleForMerchant,
  incrementRuleHit,
  insertTxn,
  linkMandate,
  recentFeedback,
} from './db';
import { addDays, isDay, istDay, istMidnightUtc } from './ist';
import { classifyTxn } from './llm';
import { parseStatement, reconcile, statementDedupeKey, type LedgerTxn, type StatementRow } from './statements';
import type { Classification, Env, FewShot } from './types';

const now = () => new Date().toISOString();

/** Rules → classifier pipeline shared with /classify, for rows that arrive from a statement. */
async function categorise(env: Env, row: StatementRow, fewshot: FewShot[]): Promise<Classification> {
  const merchant = row.merchant ?? '';
  const norm = merchant ? normalizeMerchant(merchant) : '';
  const rule = norm ? await findRuleForMerchant(env, norm) : null;
  if (rule) {
    await incrementRuleHit(env, rule.id);
    return { category: rule.category, merchant, confidence: 1, notes: 'rule:merchant' };
  }
  return classifyTxn(env, { amount: row.amount, direction: 'debit', merchant, rawText: `Bank statement: ${row.description}` }, fewshot);
}

/** Run `fn` over `items` with at most `n` in flight. */
async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export function registerAssistantRoutes(app: Hono<{ Bindings: Env }>) {
  /* ─────────────────────────── Learning check-in chat ─────────────────────────── */

  // One endpoint for the chat box. Until the day's check-in is accepted, every
  // message is a check-in attempt (validated; rejected ones get a reason back).
  // After that it's a normal conversation with the coach.
  app.post('/learning/message', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { day?: string; text?: string; topic?: string };
    const text = String(body.text ?? '').trim();
    const topic = String(body.topic ?? '').trim() || 'inference engineering';
    const day = isDay(body.day) ? body.day : istDay(Date.now());
    if (!text) return c.json({ error: 'text required' }, 400);
    if (text.length > 4000) return c.json({ error: 'too long' }, 400);

    const thread = learningThread(day);
    const ts = now();
    const already = await acceptedCheckin(c.env, day);

    if (already) {
      await addMessage(c.env, thread, 'user', text, { kind: 'chat' }, ts);
      const history = (await listMessages(c.env, thread)).map((m) => ({ role: m.role, content: m.content }));
      const reply = await coachReply(c.env, { topic, history, mode: 'chat' });
      const msg = await addMessage(c.env, thread, 'assistant', reply, { kind: 'chat' }, new Date(Date.now() + 1).toISOString());
      return c.json({ day, accepted: true, justAccepted: false, reply: msg });
    }

    const recent = (await listCheckins(c.env, 14)).map((r) => r.text);
    const verdict = await validateCheckin(c.env, { text, topic, recent });
    await insertCheckin(c.env, {
      day,
      topic,
      text,
      word_count: countWords(text),
      accepted: verdict.accepted ? 1 : 0,
      verdict_source: verdict.source,
      reason: verdict.reason,
      created_at: ts,
    });
    await addMessage(c.env, thread, 'user', text, { kind: verdict.accepted ? 'checkin' : 'attempt', source: verdict.source }, ts);

    if (!verdict.accepted) {
      const msg = await addMessage(c.env, thread, 'assistant', verdict.reason ?? 'Try again.', { kind: 'rejection', source: verdict.source }, new Date(Date.now() + 1).toISOString());
      return c.json({ day, accepted: false, justAccepted: false, reason: verdict.reason, source: verdict.source, reply: msg });
    }
    const history = [{ role: 'user' as const, content: text }];
    const reply = await coachReply(c.env, { topic, history, mode: 'accepted' });
    const msg = await addMessage(c.env, thread, 'assistant', reply, { kind: 'accepted', source: verdict.source }, new Date(Date.now() + 1).toISOString());
    return c.json({ day, accepted: true, justAccepted: true, source: verdict.source, reply: msg });
  });

  app.get('/learning/thread/:day', async (c) => {
    const day = c.req.param('day');
    if (!isDay(day)) return c.json({ error: 'bad day' }, 400);
    const [messages, accepted] = await Promise.all([listMessages(c.env, learningThread(day)), acceptedCheckin(c.env, day)]);
    return c.json({ day, accepted: !!accepted, messages });
  });

  /* ─────────────────────────── Flashcards ─────────────────────────── */

  // Import a shared ChatGPT conversation → generate MCQ flashcards.
  app.post('/flashcards/import', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: string; topic?: string; html?: string };
    const url = String(body.url ?? '').trim();
    const topic = String(body.topic ?? '').trim() || 'inference engineering';
    if (!url) return c.json({ error: 'url required' }, 400);
    try {
      const canonical = url.split('?')[0];
      if (await alreadyImported(c.env, canonical)) {
        return c.json({ added: 0, total: await countFlashcards(c.env), alreadyImported: true });
      }
      // The phone fetches the share HTML (ChatGPT 403s Cloudflare Worker egress),
      // so use the supplied HTML when present; fall back to a server fetch (works
      // from a local/other backend).
      let convo;
      if (body.html && body.html.length > 500) {
        const text = extractShareText(body.html);
        if (text.length < 200) return c.json({ error: 'That conversation had no readable content to make cards from.' }, 422);
        const title = body.html.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/\s*[-–|]\s*ChatGPT.*$/i, '').trim() || null;
        convo = { text, title };
      } else {
        convo = await fetchShareConversation(url);
      }
      const cards = await generateFlashcards(c.env, convo.text, topic);
      if (!cards.length) return c.json({ error: 'Could not generate cards from that conversation.' }, 422);
      const added = await insertFlashcards(c.env, cards, { topic, url: canonical, title: convo.title }, now());
      return c.json({ added, total: await countFlashcards(c.env), title: convo.title }, 201);
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? e) }, 422);
    }
  });

  app.get('/flashcards/count', async (c) => c.json({ count: await countFlashcards(c.env) }));

  // 5 fresh cards for the Instagram gate — answers withheld so they can't be read
  // off the wire. Grade via /flashcards/grade.
  app.get('/flashcards/quiz', async (c) => {
    const n = Math.min(Math.max(Number(c.req.query('n')) || 5, 1), 10);
    const cards = await pickQuiz(c.env, n);
    return c.json({
      count: await countFlashcards(c.env),
      cards: cards.map((f) => ({ id: f.id, question: f.question, options: JSON.parse(f.options), difficulty: f.difficulty })),
    });
  });

  // Grade a quiz. Body: { answers: { [cardId]: chosenIndex } }. Passes only if
  // every answered card is correct. Records stats.
  app.post('/flashcards/grade', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { answers?: Record<string, number> };
    const answers = body.answers ?? {};
    const ids = Object.keys(answers);
    if (!ids.length) return c.json({ error: 'answers required' }, 400);
    const cards = await getFlashcards(c.env, ids);
    const results = cards.map((f) => ({ id: f.id, correct: answers[f.id] === f.answer, answer: f.answer }));
    await recordQuizResults(c.env, results, now());
    const correct = results.filter((r) => r.correct).length;
    return c.json({ passed: correct === cards.length && cards.length > 0, correct, total: cards.length, results });
  });

  app.get('/learning/checkins', async (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 60, 365);
    const rows = await listCheckins(c.env, limit);
    // Streak: consecutive accepted days ending today or yesterday.
    const days = new Set(rows.map((r) => r.day));
    let streak = 0;
    let d = istDay(Date.now());
    if (!days.has(d)) d = addDays(d, -1);
    while (days.has(d)) {
      streak++;
      d = addDays(d, -1);
    }
    return c.json({ checkins: rows, streak });
  });

  /* ─────────────────────────── Morning blanket proof ─────────────────────────── */

  app.post('/focus/blanket', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { imageBase64?: string; mimeType?: string; day?: string };
    if (!body.imageBase64) return c.json({ error: 'imageBase64 required' }, 400);
    const day = isDay(body.day) ? body.day : istDay(Date.now());
    const b64 = body.imageBase64.includes(',') ? body.imageBase64.slice(body.imageBase64.indexOf(',') + 1) : body.imageBase64;
    const verdict = await verifyBlanket(c.env, b64, body.mimeType ?? 'image/jpeg');

    let r2Key: string | null = null;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      r2Key = `focus/blanket/${day}/${crypto.randomUUID()}.jpg`;
      await c.env.ATTACHMENTS.put(r2Key, bytes, { httpMetadata: { contentType: body.mimeType ?? 'image/jpeg' } });
    } catch {
      r2Key = null; // the proof photo is nice-to-have; the verdict is what matters
    }
    const event = await insertFocusEvent(c.env, {
      kind: 'blanket',
      day,
      ok: verdict.verified ? 1 : 0,
      fail_open: verdict.failOpen ? 1 : 0,
      reason: verdict.reason,
      detail: verdict.detail ? JSON.stringify(verdict.detail) : null,
      r2_key: r2Key,
      created_at: now(),
    });
    return c.json({ ...verdict, day, eventId: event.id });
  });

  app.get('/focus/blanket', async (c) => {
    const limit = Math.min(Number(c.req.query('limit')) || 30, 200);
    return c.json({ events: await listFocusEvents(c.env, 'blanket', limit) });
  });

  app.get('/focus/blanket/:id/photo', async (c) => {
    const row = await c.env.DB.prepare('SELECT r2_key FROM focus_events WHERE id = ?').bind(c.req.param('id')).first<{ r2_key: string | null }>();
    if (!row?.r2_key) return c.json({ error: 'not found' }, 404);
    const obj = await c.env.ATTACHMENTS.get(row.r2_key);
    if (!obj) return c.json({ error: 'object missing' }, 404);
    return new Response(obj.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000' } });
  });

  /* ─────────────────────────── Statement reconciliation ─────────────────────────── */

  app.post('/statements/parse', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { fileName?: string; pages?: string[]; images?: string[] };
    const pages = Array.isArray(body.pages) ? body.pages.map(String).slice(0, 60) : [];
    const images = Array.isArray(body.images) ? body.images.map(String).slice(0, 12) : [];
    if (!pages.some((p) => p.trim()) && !images.length) return c.json({ error: 'statement text or page images required' }, 400);

    let parsed;
    try {
      parsed = await parseStatement(c.env, { pages, images });
    } catch (e: any) {
      return c.json({ error: String(e?.message ?? e) }, 422);
    }

    // Ledger window: the statement period ±3 days (IST) so edge matches still pair.
    const from = new Date(istMidnightUtc(addDays(parsed.periodStart, -3))).toISOString();
    const to = new Date(istMidnightUtc(addDays(parsed.periodEnd, 4)) - 1).toISOString();
    const { results } = await c.env.DB.prepare(
      `SELECT id, amount, direction, occurred_at, created_at, merchant, raw_text, ref_no, source, account_tail, category
         FROM transactions
        WHERE direction = 'debit' AND COALESCE(occurred_at, created_at) BETWEEN ? AND ?`,
    ).bind(from, to).all<LedgerTxn>();
    const rec = reconcile(parsed, results ?? []);
    // A removal you already declined on an earlier statement stays "keep" by default.
    const kept = await c.env.DB.prepare(
      "SELECT DISTINCT txn_id FROM statement_items WHERE kind = 'remove' AND decision = 'denied' AND txn_id IS NOT NULL",
    ).all<{ txn_id: string }>();
    const keptIds = new Set((kept.results ?? []).map((r) => r.txn_id));
    for (const r of rec.removes) {
      if (keptIds.has(r.txn.id)) {
        r.suggested = 'deny';
        r.note = 'You kept this on an earlier statement.';
      }
    }

    const fewshot = (await recentFeedback(c.env)) as FewShot[];
    const addCats = await mapLimit(rec.adds, 4, (r) => categorise(c.env, r, fewshot));

    const id = crypto.randomUUID();
    const ts = now();
    const items: StatementItemDb[] = [
      ...rec.adds.map((r, i) => ({
        id: crypto.randomUUID(), statement_id: id, kind: 'add' as const, txn_id: null, date: r.date, amount: r.amount,
        description: r.description, merchant: addCats[i].merchant || r.merchant, category: addCats[i].category, ref: r.ref,
        balance: r.balance, suggested: 'approve' as const, decision: null, note: null, created_at: ts,
      })),
      ...rec.removes.map((x) => ({
        id: crypto.randomUUID(), statement_id: id, kind: 'remove' as const, txn_id: x.txn.id,
        date: (x.txn.occurred_at ?? x.txn.created_at), amount: x.txn.amount, description: x.txn.raw_text?.slice(0, 300) ?? null,
        merchant: x.txn.merchant, category: x.txn.category, ref: x.txn.ref_no, balance: null, suggested: x.suggested,
        decision: null, note: x.note, created_at: ts,
      })),
      ...rec.matches.map((m) => ({
        id: crypto.randomUUID(), statement_id: id, kind: 'match' as const, txn_id: m.txn.id, date: m.row.date,
        amount: m.row.amount, description: m.row.description, merchant: m.txn.merchant ?? m.row.merchant,
        category: m.txn.category, ref: m.row.ref, balance: m.row.balance, suggested: null, decision: null,
        note: m.via === 'ref' ? 'matched by UPI reference' : 'matched by amount + date', created_at: ts,
      })),
    ];
    const debitCount = parsed.rows.filter((r) => r.type === 'debit').length;
    await insertStatement(c.env, {
      id, file_name: body.fileName ?? null, bank: parsed.bank, account_tail: parsed.accountTail,
      period_start: parsed.periodStart, period_end: parsed.periodEnd, row_count: parsed.rows.length,
      debit_count: debitCount, credit_count: parsed.rows.length - debitCount,
      balance_checked: parsed.balanceCheck.checked, balance_ok: parsed.balanceCheck.ok, parser: parsed.parser,
      status: 'pending', added: 0, removed: 0, created_at: ts, applied_at: null,
    }, items);
    return c.json(await getStatement(c.env, id), 201);
  });

  app.get('/statements', async (c) => c.json({ statements: await listStatements(c.env, Math.min(Number(c.req.query('limit')) || 20, 100)) }));

  app.get('/statements/:id', async (c) => {
    const s = await getStatement(c.env, c.req.param('id'));
    return s ? c.json(s) : c.json({ error: 'not found' }, 404);
  });

  // Apply the user's per-item decisions. Body: { decisions: { [itemId]: 'approve' | 'deny' |
  // { decision, category? } } }. Items without a decision are treated as denied.
  app.post('/statements/:id/apply', async (c) => {
    const s = await getStatement(c.env, c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    if (s.statement.status === 'applied') return c.json({ error: 'already applied', ...s }, 409);
    const body = (await c.req.json().catch(() => ({}))) as { decisions?: Record<string, unknown> };
    const decisions = body.decisions ?? {};
    const ts = now();

    // Build every write as a prepared statement and run them in ONE atomic D1
    // batch (chunked). The old per-item sequential loop did ~5 round-trips ×
    // dozens of items, which blew the Worker's limit and aborted PART-WAY —
    // leaving the ledger half-reconciled. This is a couple of round-trips total.
    //
    // Resumable + idempotent: items already decided by a prior (partial) run are
    // skipped, and adds use INSERT OR IGNORE on the unique dedupe_key, so
    // re-tapping Apply finishes the rest and never double-inserts.
    const writes: D1PreparedStatement[] = [];
    const attachmentCleanup: string[] = []; // txn ids whose R2 attachments to drop (removes)

    const TXN_COLS =
      'id, device_id, dedupe_key, raw_text, amount, direction, currency, bank, merchant, merchant_norm, ' +
      'account_tail, ref_no, balance, occurred_at, category, confidence, notes, user_note, tags, source, ' +
      'corrected, created_at, updated_at';

    for (const item of s.items) {
      if (item.kind === 'match' || item.decision) continue; // matches never change; decided items are done
      const d = decisions[item.id];
      const decision = typeof d === 'string' ? d : (d as any)?.decision;
      const approve = decision === 'approve' || decision === 'approved';

      if (!approve) {
        writes.push(c.env.DB.prepare('UPDATE statement_items SET decision = ? WHERE id = ?').bind('denied', item.id));
        continue;
      }

      if (item.kind === 'remove' && item.txn_id) {
        attachmentCleanup.push(item.txn_id);
        writes.push(c.env.DB.prepare('DELETE FROM dedupe_alias WHERE txn_id = ?').bind(item.txn_id));
        writes.push(c.env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(item.txn_id));
        writes.push(c.env.DB.prepare('UPDATE statement_items SET decision = ? WHERE id = ?').bind('approved', item.id));
      } else if (item.kind === 'add') {
        const chosen = typeof d === 'object' && d ? (d as any).category : undefined;
        const category = chosen && isCategory(chosen) ? chosen : item.category && isCategory(item.category) ? item.category : 'Other';
        const dedupeKey = statementDedupeKey(s.statement.account_tail, {
          date: item.date!, amount: item.amount, ref: item.ref, description: item.description ?? '',
        });
        const id = crypto.randomUUID();
        const merchant = item.merchant ?? null;
        const occurredAt = new Date(istMidnightUtc(item.date!) + 12 * 3600_000).toISOString();
        writes.push(
          c.env.DB.prepare(`INSERT OR IGNORE INTO transactions (${TXN_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
            id, null, dedupeKey, `Bank statement: ${item.description ?? ''}`.trim(), item.amount, 'debit', 'INR',
            s.statement.bank ?? null, merchant, merchant ? normalizeMerchant(merchant) || null : null,
            s.statement.account_tail ?? null, item.ref ?? null, item.balance ?? null, occurredAt, category,
            chosen ? 1 : 0.8, 'statement', null, null, 'statement', chosen ? 1 : 0, ts, ts,
          ),
        );
        writes.push(c.env.DB.prepare('UPDATE statement_items SET decision = ?, txn_id = ? WHERE id = ?').bind('approved', id, item.id));
      }
    }

    // R2 attachment bytes can't go in a D1 batch — clear them first (removes are few).
    for (const txnId of attachmentCleanup) {
      try {
        await deleteAttachmentsForTxn(c.env, txnId);
      } catch {
        /* best-effort */
      }
    }
    // 100 statements/batch keeps a typical statement to a single atomic commit.
    for (let i = 0; i < writes.length; i += 100) await c.env.DB.batch(writes.slice(i, i + 100));

    // Final tallies from the source of truth (covers this run + any earlier partial run).
    const tally = await c.env.DB.prepare(
      "SELECT SUM(kind='add' AND decision='approved') AS added, SUM(kind='remove' AND decision='approved') AS removed FROM statement_items WHERE statement_id = ?",
    ).bind(s.statement.id).first<{ added: number; removed: number }>();
    const added = tally?.added ?? 0;
    const removed = tally?.removed ?? 0;
    await markStatementApplied(c.env, s.statement.id, added, removed, ts);
    return c.json({ added, removed, ...(await getStatement(c.env, s.statement.id)) });
  });
}
