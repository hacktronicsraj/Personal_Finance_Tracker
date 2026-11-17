import type { Env } from './types';

/* ───────────────────────────── Learning check-ins ───────────────────────────── */

export interface CheckinRow {
  id: string;
  day: string;
  topic: string | null;
  text: string;
  word_count: number;
  accepted: number;
  verdict_source: string | null;
  reason: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  thread: string;
  role: 'user' | 'assistant';
  content: string;
  meta: string | null;
  created_at: string;
}

export const learningThread = (day: string) => `learning:${day}`;

export async function insertCheckin(env: Env, row: Omit<CheckinRow, 'id'>): Promise<CheckinRow> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO learning_checkins (id, day, topic, text, word_count, accepted, verdict_source, reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(id, row.day, row.topic, row.text, row.word_count, row.accepted, row.verdict_source, row.reason, row.created_at).run();
  return { id, ...row };
}

export async function acceptedCheckin(env: Env, day: string): Promise<CheckinRow | null> {
  return env.DB.prepare('SELECT * FROM learning_checkins WHERE day = ? AND accepted = 1 ORDER BY created_at LIMIT 1')
    .bind(day).first<CheckinRow>();
}

/** Accepted check-ins, newest first — the history screen and the anti-copy check. */
export async function listCheckins(env: Env, limit = 60): Promise<CheckinRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM learning_checkins WHERE accepted = 1 ORDER BY day DESC, created_at DESC LIMIT ?',
  ).bind(limit).all<CheckinRow>();
  return results ?? [];
}

export async function addMessage(env: Env, thread: string, role: MessageRow['role'], content: string, meta: unknown, now: string): Promise<MessageRow> {
  const id = crypto.randomUUID();
  const metaStr = meta == null ? null : JSON.stringify(meta);
  await env.DB.prepare('INSERT INTO assistant_messages (id, thread, role, content, meta, created_at) VALUES (?,?,?,?,?,?)')
    .bind(id, thread, role, content, metaStr, now).run();
  return { id, thread, role, content, meta: metaStr, created_at: now };
}

export async function listMessages(env: Env, thread: string, limit = 200): Promise<MessageRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM assistant_messages WHERE thread = ? ORDER BY created_at ASC, rowid ASC LIMIT ?',
  ).bind(thread, limit).all<MessageRow>();
  return results ?? [];
}

/* ─────────────────────────────── Focus events ─────────────────────────────── */

export interface FocusEventRow {
  id: string;
  kind: string; // 'blanket'
  day: string;
  ok: number;
  fail_open: number;
  reason: string | null;
  detail: string | null;
  r2_key: string | null;
  created_at: string;
}

export async function insertFocusEvent(env: Env, row: Omit<FocusEventRow, 'id'>): Promise<FocusEventRow> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO focus_events (id, kind, day, ok, fail_open, reason, detail, r2_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(id, row.kind, row.day, row.ok, row.fail_open, row.reason, row.detail, row.r2_key, row.created_at).run();
  return { id, ...row };
}

export async function listFocusEvents(env: Env, kind: string, limit = 30): Promise<FocusEventRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM focus_events WHERE kind = ? ORDER BY created_at DESC LIMIT ?')
    .bind(kind, limit).all<FocusEventRow>();
  return results ?? [];
}

/* ─────────────────────────────── Statements ─────────────────────────────── */

export interface StatementRowDb {
  id: string;
  file_name: string | null;
  bank: string | null;
  account_tail: string | null;
  period_start: string;
  period_end: string;
  row_count: number;
  debit_count: number;
  credit_count: number;
  balance_checked: number;
  balance_ok: number;
  parser: string;
  status: 'pending' | 'applied';
  added: number;
  removed: number;
  created_at: string;
  applied_at: string | null;
}

export interface StatementItemDb {
  id: string;
  statement_id: string;
  kind: 'add' | 'remove' | 'match';
  txn_id: string | null;
  date: string | null;
  amount: number;
  description: string | null;
  merchant: string | null;
  category: string | null;
  ref: string | null;
  balance: number | null;
  suggested: 'approve' | 'deny' | null;
  decision: 'approved' | 'denied' | null;
  note: string | null;
  created_at: string;
}

export async function insertStatement(env: Env, s: StatementRowDb, items: StatementItemDb[]): Promise<void> {
  const stmts = [
    env.DB.prepare(
      `INSERT INTO statements (id, file_name, bank, account_tail, period_start, period_end, row_count, debit_count,
         credit_count, balance_checked, balance_ok, parser, status, added, removed, created_at, applied_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(s.id, s.file_name, s.bank, s.account_tail, s.period_start, s.period_end, s.row_count, s.debit_count,
      s.credit_count, s.balance_checked, s.balance_ok, s.parser, s.status, s.added, s.removed, s.created_at, s.applied_at),
    ...items.map((i) =>
      env.DB.prepare(
        `INSERT INTO statement_items (id, statement_id, kind, txn_id, date, amount, description, merchant, category, ref,
           balance, suggested, decision, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(i.id, i.statement_id, i.kind, i.txn_id, i.date, i.amount, i.description, i.merchant, i.category, i.ref,
        i.balance, i.suggested, i.decision, i.note, i.created_at),
    ),
  ];
  // D1 batches are transactional and capped at a generous statement count; chunk to be safe.
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

export async function getStatement(env: Env, id: string): Promise<{ statement: StatementRowDb; items: StatementItemDb[] } | null> {
  const statement = await env.DB.prepare('SELECT * FROM statements WHERE id = ?').bind(id).first<StatementRowDb>();
  if (!statement) return null;
  const { results } = await env.DB.prepare(
    `SELECT * FROM statement_items WHERE statement_id = ?
      ORDER BY CASE kind WHEN 'add' THEN 0 WHEN 'remove' THEN 1 ELSE 2 END, date, amount`,
  ).bind(id).all<StatementItemDb>();
  return { statement, items: results ?? [] };
}

export async function listStatements(env: Env, limit = 20): Promise<StatementRowDb[]> {
  const { results } = await env.DB.prepare('SELECT * FROM statements ORDER BY created_at DESC LIMIT ?').bind(limit).all<StatementRowDb>();
  return results ?? [];
}

export async function setItemDecision(env: Env, id: string, decision: 'approved' | 'denied', txnId?: string | null): Promise<void> {
  if (txnId !== undefined) {
    await env.DB.prepare('UPDATE statement_items SET decision = ?, txn_id = ? WHERE id = ?').bind(decision, txnId, id).run();
  } else {
    await env.DB.prepare('UPDATE statement_items SET decision = ? WHERE id = ?').bind(decision, id).run();
  }
}

export async function markStatementApplied(env: Env, id: string, added: number, removed: number, now: string): Promise<void> {
  await env.DB.prepare("UPDATE statements SET status = 'applied', added = ?, removed = ?, applied_at = ? WHERE id = ?")
    .bind(added, removed, now, id).run();
}

/* ─────────────────────────────── Flashcards ─────────────────────────────── */

export interface FlashcardRow {
  id: string;
  topic: string | null;
  question: string;
  options: string; // JSON array
  answer: number;
  difficulty: string;
  source_url: string | null;
  source_title: string | null;
  times_shown: number;
  times_correct: number;
  created_at: string;
}

export async function insertFlashcards(
  env: Env,
  cards: { question: string; options: string[]; answer: number; difficulty: string }[],
  meta: { topic: string; url: string; title: string | null },
  now: string,
): Promise<number> {
  if (!cards.length) return 0;
  const writes = cards.map((c) =>
    env.DB.prepare(
      `INSERT INTO flashcards (id, topic, question, options, answer, difficulty, source_url, source_title, times_shown, times_correct, created_at)
       VALUES (?,?,?,?,?,?,?,?,0,0,?)`,
    ).bind(crypto.randomUUID(), meta.topic, c.question, JSON.stringify(c.options), c.answer, c.difficulty, meta.url, meta.title, now),
  );
  for (let i = 0; i < writes.length; i += 50) await env.DB.batch(writes.slice(i, i + 50));
  await env.DB.prepare(
    `INSERT INTO flashcard_sources (url, title, card_count, created_at) VALUES (?,?,?,?)
     ON CONFLICT(url) DO UPDATE SET card_count = card_count + excluded.card_count, title = excluded.title`,
  ).bind(meta.url, meta.title, cards.length, now).run();
  return cards.length;
}

export async function countFlashcards(env: Env): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM flashcards').first<{ n: number }>();
  return r?.n ?? 0;
}

export async function alreadyImported(env: Env, url: string): Promise<boolean> {
  const r = await env.DB.prepare('SELECT 1 FROM flashcard_sources WHERE url = ?').bind(url).first();
  return !!r;
}

/** Pick `n` flashcards for a quiz, preferring the least-shown ones, with variety. */
export async function pickQuiz(env: Env, n: number): Promise<FlashcardRow[]> {
  // Over-select the least-shown, then shuffle in JS so repeat quizzes vary.
  const { results } = await env.DB.prepare(
    'SELECT * FROM flashcards ORDER BY times_shown ASC, RANDOM() LIMIT ?',
  ).bind(Math.max(n * 4, n)).all<FlashcardRow>();
  const pool = results ?? [];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

export async function getFlashcards(env: Env, ids: string[]): Promise<FlashcardRow[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT * FROM flashcards WHERE id IN (${placeholders})`).bind(...ids).all<FlashcardRow>();
  return results ?? [];
}

export async function recordQuizResults(env: Env, graded: { id: string; correct: boolean }[], now: string): Promise<void> {
  if (!graded.length) return;
  const writes = graded.map((g) =>
    env.DB.prepare('UPDATE flashcards SET times_shown = times_shown + 1, times_correct = times_correct + ? WHERE id = ?')
      .bind(g.correct ? 1 : 0, g.id),
  );
  for (let i = 0; i < writes.length; i += 50) await env.DB.batch(writes.slice(i, i + 50));
}
