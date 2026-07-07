import type { Classification, Env, ParsedTxn } from './types';

export interface TxnRow {
  id: string;
  device_id: string | null;
  dedupe_key: string | null;
  raw_text: string;
  amount: number;
  direction: string;
  currency: string;
  bank: string | null;
  merchant: string | null;
  account_tail: string | null;
  ref_no: string | null;
  balance: number | null;
  occurred_at: string | null;
  category: string;
  confidence: number;
  notes: string | null;
  source: string;
  corrected: number;
  created_at: string;
  updated_at: string;
}

export function makeDedupeKey(deviceId: string | undefined, p: ParsedTxn): string {
  return [deviceId ?? 'dev', p.accountTail ?? '', p.amount, p.direction, p.occurredAt ?? '', p.refNo ?? '']
    .join('|');
}

export async function findByDedupe(env: Env, key: string): Promise<TxnRow | null> {
  return env.DB.prepare('SELECT * FROM transactions WHERE dedupe_key = ?').bind(key).first<TxnRow>();
}

/** Resolve an event key that previously merged into an existing transaction. */
export async function findByAlias(env: Env, key: string): Promise<TxnRow | null> {
  const alias = await env.DB.prepare('SELECT txn_id FROM dedupe_alias WHERE dedupe_key = ?')
    .bind(key)
    .first<{ txn_id: string }>();
  if (!alias) return null;
  return env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(alias.txn_id).first<TxnRow>();
}

async function addAlias(env: Env, key: string, txnId: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO dedupe_alias (dedupe_key, txn_id) VALUES (?,?)')
    .bind(key, txnId)
    .run();
}

/**
 * Find an existing transaction that is very likely the SAME payment seen through a
 * DIFFERENT channel (e.g. a GPay notification for a payment the bank also SMS'd):
 * same amount + direction, a different source, ingested within `sinceIso`. Used to
 * avoid double-counting when two capture channels see one payment.
 *
 * Trade-off: two genuinely separate same-amount cross-source payments within the
 * window would merge. Acceptable for a personal tool; the window keeps it rare.
 */
export async function findFuzzyMatch(
  env: Env,
  args: { deviceId?: string; amount: number; direction: string; source: string; sinceIso: string },
): Promise<TxnRow | null> {
  return env.DB.prepare(
    `SELECT * FROM transactions
       WHERE amount = ? AND direction = ? AND source <> ?
         AND created_at >= ?
         AND (device_id IS ? OR ? IS NULL)
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(args.amount, args.direction, args.source, args.sinceIso, args.deviceId ?? null, args.deviceId ?? null)
    .first<TxnRow>();
}

/**
 * Enrich an existing transaction with a second channel's view of the same payment.
 * Bank SMS is the record-of-truth (fills account/balance/ref, forces source='sms');
 * a cleaner GPay/shared merchant name wins over the SMS-parsed one unless the user
 * has already corrected the row. Never creates a new row.
 */
export async function mergeTxn(
  env: Env,
  existing: TxnRow,
  incoming: { source: string; parsed: ParsedTxn; dedupeKey: string },
  now: string,
): Promise<TxnRow> {
  const p = incoming.parsed;
  const source = existing.source === 'sms' || incoming.source === 'sms' ? 'sms' : existing.source;
  const preferIncomingMerchant = incoming.source !== 'sms' && !!p.merchant && !existing.corrected;
  const merchant = preferIncomingMerchant ? p.merchant! : existing.merchant ?? p.merchant ?? null;
  await env.DB.prepare(
    `UPDATE transactions
       SET source = ?, merchant = ?, bank = ?, account_tail = ?, ref_no = ?, balance = ?,
           occurred_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      source,
      merchant,
      existing.bank ?? p.bank ?? null,
      existing.account_tail ?? p.accountTail ?? null,
      existing.ref_no ?? p.refNo ?? null,
      existing.balance ?? p.balance ?? null,
      existing.occurred_at ?? p.occurredAt ?? null,
      now,
      existing.id,
    )
    .run();
  await addAlias(env, incoming.dedupeKey, existing.id);
  return (await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(existing.id).first<TxnRow>())!;
}

export async function insertTxn(
  env: Env,
  args: {
    deviceId?: string;
    dedupeKey: string;
    rawText: string;
    parsed: ParsedTxn;
    cls: Classification;
    now: string;
    source?: string;
    corrected?: number;
  },
): Promise<TxnRow> {
  const id = crypto.randomUUID();
  const { parsed: p, cls } = args;
  await env.DB.prepare(
    `INSERT INTO transactions
      (id, device_id, dedupe_key, raw_text, amount, direction, currency, bank, merchant,
       account_tail, ref_no, balance, occurred_at, category, confidence, notes, source,
       corrected, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      args.deviceId ?? null,
      args.dedupeKey,
      args.rawText,
      p.amount,
      p.direction,
      p.currency ?? 'INR',
      p.bank ?? null,
      cls.merchant || p.merchant || null,
      p.accountTail ?? null,
      p.refNo ?? null,
      p.balance ?? null,
      p.occurredAt ?? null,
      cls.category,
      cls.confidence,
      cls.notes ?? null,
      args.source ?? 'sms',
      args.corrected ?? 0,
      args.now,
      args.now,
    )
    .run();
  return (await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TxnRow>())!;
}

export async function listTxns(
  env: Env,
  q: { from?: string; to?: string; category?: string; search?: string; limit?: number },
): Promise<TxnRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.from) { where.push('occurred_at >= ?'); binds.push(q.from); }
  if (q.to) { where.push('occurred_at <= ?'); binds.push(q.to); }
  if (q.category) { where.push('category = ?'); binds.push(q.category); }
  if (q.search) { where.push('(merchant LIKE ? OR raw_text LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`); }
  const sql =
    `SELECT * FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}` +
    ` ORDER BY COALESCE(occurred_at, created_at) DESC LIMIT ?`;
  binds.push(q.limit ?? 200);
  const { results } = await env.DB.prepare(sql).bind(...binds).all<TxnRow>();
  return results ?? [];
}

export async function updateCategory(
  env: Env,
  id: string,
  category: string,
  now: string,
): Promise<TxnRow | null> {
  const existing = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TxnRow>();
  if (!existing) return null;
  await env.DB.prepare(
    'UPDATE transactions SET category = ?, corrected = 1, confidence = 1.0, updated_at = ? WHERE id = ?',
  ).bind(category, now, id).run();
  await env.DB.prepare(
    'INSERT INTO classification_feedback (id, txn_id, predicted_category, corrected_category, merchant, raw_text, created_at) VALUES (?,?,?,?,?,?,?)',
  ).bind(crypto.randomUUID(), id, existing.category, category, existing.merchant, existing.raw_text, now).run();
  return env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TxnRow>();
}

export async function recentFeedback(env: Env, limit = 12) {
  const { results } = await env.DB.prepare(
    'SELECT raw_text, merchant, corrected_category FROM classification_feedback ORDER BY created_at DESC LIMIT ?',
  ).bind(limit).all();
  return (results ?? []) as any[];
}

export async function categorySummary(env: Env, from?: string, to?: string) {
  const where: string[] = ["direction = 'debit'"];
  const binds: unknown[] = [];
  if (from) { where.push('occurred_at >= ?'); binds.push(from); }
  if (to) { where.push('occurred_at <= ?'); binds.push(to); }
  const sql = `SELECT category, COUNT(*) AS count, SUM(amount) AS total
               FROM transactions WHERE ${where.join(' AND ')}
               GROUP BY category ORDER BY total DESC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results ?? []) as { category: string; count: number; total: number }[];
}

export async function topMerchants(env: Env, from?: string, to?: string, limit = 10) {
  const where: string[] = ["direction = 'debit'", 'merchant IS NOT NULL'];
  const binds: unknown[] = [];
  if (from) { where.push('occurred_at >= ?'); binds.push(from); }
  if (to) { where.push('occurred_at <= ?'); binds.push(to); }
  const sql = `SELECT merchant, COUNT(*) AS count, SUM(amount) AS total
               FROM transactions WHERE ${where.join(' AND ')}
               GROUP BY merchant ORDER BY total DESC LIMIT ?`;
  binds.push(limit);
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results ?? []) as { merchant: string; count: number; total: number }[];
}

export async function changedSince(env: Env, cursor: string, limit = 500): Promise<TxnRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM transactions WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?',
  ).bind(cursor, limit).all<TxnRow>();
  return results ?? [];
}

export async function listCategories(env: Env) {
  const { results } = await env.DB.prepare('SELECT id, name, icon, color, is_default FROM categories ORDER BY is_default DESC, name ASC').all();
  return results ?? [];
}

export async function addCategory(env: Env, name: string, icon?: string, color?: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  await env.DB.prepare('INSERT OR IGNORE INTO categories (id, name, icon, color, is_default) VALUES (?,?,?,?,0)')
    .bind(id, name, icon ?? null, color ?? '#94a3b8').run();
  return env.DB.prepare('SELECT id, name, icon, color, is_default FROM categories WHERE id = ?').bind(id).first();
}
