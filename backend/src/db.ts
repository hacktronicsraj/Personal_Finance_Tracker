import { normalizeMerchant } from './classify';
import type { Classification, Env, ParsedTxn, TxnRow } from './types';

export const now = (): string => new Date().toISOString();
export const uid = (): string => crypto.randomUUID();

/** Columns returned to the client, with the payee alias resolved on read. */
const TXN_SELECT = `
  t.id, t.device_id, t.dedupe_key, t.raw_text, t.amount, t.direction, t.currency,
  t.bank, COALESCE(a.display_name, t.merchant) AS merchant, t.merchant AS merchant_raw,
  t.account_tail, t.ref_no, t.balance, t.occurred_at, t.category, t.confidence,
  t.notes, t.user_note, t.tags, t.merchant_norm, t.source, t.corrected,
  t.created_at, t.updated_at
  FROM transactions t
  LEFT JOIN merchant_alias a ON a.pattern = t.merchant_norm`;

export interface TxnFilters {
  from?: string;
  to?: string;
  category?: string;
  q?: string;
  limit?: number;
}

export async function listTransactions(env: Env, f: TxnFilters = {}): Promise<TxnRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (f.from) { where.push('COALESCE(t.occurred_at, t.created_at) >= ?'); binds.push(f.from); }
  if (f.to) { where.push('COALESCE(t.occurred_at, t.created_at) <= ?'); binds.push(f.to); }
  if (f.category) { where.push('t.category = ?'); binds.push(f.category); }
  if (f.q) { where.push('(t.merchant LIKE ? OR t.raw_text LIKE ?)'); binds.push(`%${f.q}%`, `%${f.q}%`); }
  const sql = `SELECT ${TXN_SELECT}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(t.occurred_at, t.created_at) DESC, t.created_at DESC
    LIMIT ?`;
  binds.push(Math.min(f.limit ?? 500, 2000));
  const res = await env.DB.prepare(sql).bind(...binds).all<TxnRow>();
  return res.results ?? [];
}

export async function getTransaction(env: Env, id: string): Promise<TxnRow | null> {
  return env.DB.prepare(`SELECT ${TXN_SELECT} WHERE t.id = ?`).bind(id).first<TxnRow>();
}

/**
 * Insert a classified transaction, idempotently. A repeat dedupe_key returns the
 * existing row (via the row itself or a dedupe_alias) instead of inserting twice.
 */
export async function insertTransaction(
  env: Env,
  parsed: ParsedTxn,
  cls: Classification,
  meta: { deviceId?: string; dedupeKey?: string; source?: string; userNote?: string; tags?: string[] },
): Promise<{ txn: TxnRow; deduped: boolean }> {
  if (meta.dedupeKey) {
    const existing = await env.DB.prepare('SELECT id FROM transactions WHERE dedupe_key = ?')
      .bind(meta.dedupeKey).first<{ id: string }>();
    if (existing) return { txn: (await getTransaction(env, existing.id))!, deduped: true };
    const alias = await env.DB.prepare('SELECT txn_id FROM dedupe_alias WHERE dedupe_key = ?')
      .bind(meta.dedupeKey).first<{ txn_id: string }>();
    if (alias) return { txn: (await getTransaction(env, alias.txn_id))!, deduped: true };
  }

  const id = uid();
  const ts = now();
  const merchantNorm = normalizeMerchant(cls.merchant || parsed.merchant || '');
  await env.DB.prepare(
    `INSERT INTO transactions
      (id, device_id, dedupe_key, raw_text, amount, direction, currency, bank, merchant,
       account_tail, ref_no, balance, occurred_at, category, confidence, notes, user_note,
       tags, merchant_norm, source, corrected, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
  ).bind(
    id, meta.deviceId ?? null, meta.dedupeKey ?? null, parsed.rawText ?? '', parsed.amount,
    parsed.direction, parsed.currency ?? 'INR', parsed.bank ?? null, cls.merchant || parsed.merchant || null,
    parsed.accountTail ?? null, parsed.refNo ?? null, parsed.balance ?? null, parsed.occurredAt ?? null,
    cls.category, cls.confidence, cls.notes, meta.userNote ?? null,
    meta.tags ? JSON.stringify(meta.tags) : null, merchantNorm || null, meta.source ?? 'sms', ts, ts,
  ).run();
  return { txn: (await getTransaction(env, id))!, deduped: false };
}

export async function patchTransaction(
  env: Env,
  id: string,
  fields: { category?: string; merchant?: string | null; amount?: number; user_note?: string | null; tags?: string[] },
): Promise<TxnRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (fields.category !== undefined) { sets.push('category = ?', 'corrected = 1'); binds.push(fields.category); }
  if (fields.merchant !== undefined) {
    sets.push('merchant = ?', 'merchant_norm = ?');
    binds.push(fields.merchant, normalizeMerchant(fields.merchant ?? ''));
  }
  if (fields.amount !== undefined) { sets.push('amount = ?'); binds.push(fields.amount); }
  if (fields.user_note !== undefined) { sets.push('user_note = ?'); binds.push(fields.user_note); }
  if (fields.tags !== undefined) { sets.push('tags = ?'); binds.push(JSON.stringify(fields.tags)); }
  if (!sets.length) return getTransaction(env, id);
  sets.push('updated_at = ?'); binds.push(now());
  binds.push(id);
  await env.DB.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return getTransaction(env, id);
}

export async function deleteTransaction(env: Env, id: string): Promise<void> {
  await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
}

/* ─────────────────────────── Categories ─────────────────────────── */

export async function listCategories(env: Env) {
  const res = await env.DB.prepare('SELECT id, name, icon, color, is_default FROM categories ORDER BY is_default DESC, name').all();
  return res.results ?? [];
}

export async function createCategory(env: Env, name: string, color?: string, icon?: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await env.DB.prepare('INSERT OR IGNORE INTO categories (id, name, icon, color, is_default) VALUES (?,?,?,?,0)')
    .bind(id, name, icon ?? null, color ?? null).run();
  return env.DB.prepare('SELECT id, name, icon, color, is_default FROM categories WHERE id = ?').bind(id).first();
}

/* ─────────────────────────── Payee aliases ─────────────────────────── */

export async function listAliases(env: Env) {
  const res = await env.DB.prepare('SELECT pattern, display_name FROM merchant_alias ORDER BY display_name').all();
  return res.results ?? [];
}

/** Name a payee by its current (raw) merchant string; applies to its whole history. */
export async function setAlias(env: Env, merchant: string, displayName: string): Promise<number> {
  const pattern = normalizeMerchant(merchant);
  if (!pattern) return 0;
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO merchant_alias (pattern, display_name, created_at, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(pattern) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
  ).bind(pattern, displayName, ts, ts).run();
  const cnt = await env.DB.prepare('SELECT COUNT(*) AS n FROM transactions WHERE merchant_norm = ?')
    .bind(pattern).first<{ n: number }>();
  return cnt?.n ?? 0;
}

export async function clearAlias(env: Env, pattern: string): Promise<void> {
  await env.DB.prepare('DELETE FROM merchant_alias WHERE pattern = ?').bind(pattern).run();
}

/* ─────────────────────────── Analytics ─────────────────────────── */

export interface AnalyticsSummary {
  totalSpent: number;
  byCategory: { category: string; count: number; total: number }[];
  topMerchants: { merchant: string; count: number; total: number }[];
}

/** Spend analytics over a window. Debit only, excluding Card Payment settlements. */
export async function analyticsSummary(env: Env, from?: string, to?: string): Promise<AnalyticsSummary> {
  const where = ["t.direction = 'debit'", "t.category != 'Card Payment'"];
  const binds: unknown[] = [];
  if (from) { where.push('COALESCE(t.occurred_at, t.created_at) >= ?'); binds.push(from); }
  if (to) { where.push('COALESCE(t.occurred_at, t.created_at) <= ?'); binds.push(to); }
  const w = 'WHERE ' + where.join(' AND ');

  const total = await env.DB.prepare(`SELECT COALESCE(SUM(t.amount),0) AS s FROM transactions t ${w}`)
    .bind(...binds).first<{ s: number }>();
  const byCat = await env.DB.prepare(
    `SELECT t.category AS category, COUNT(*) AS count, SUM(t.amount) AS total
     FROM transactions t ${w} GROUP BY t.category ORDER BY total DESC`,
  ).bind(...binds).all<{ category: string; count: number; total: number }>();
  const byMerch = await env.DB.prepare(
    `SELECT COALESCE(a.display_name, t.merchant) AS merchant, COUNT(*) AS count, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN merchant_alias a ON a.pattern = t.merchant_norm
     ${w} AND t.merchant IS NOT NULL
     GROUP BY t.merchant_norm ORDER BY total DESC LIMIT 10`,
  ).bind(...binds).all<{ merchant: string; count: number; total: number }>();

  return { totalSpent: total?.s ?? 0, byCategory: byCat.results ?? [], topMerchants: byMerch.results ?? [] };
}

/* ─────────────────────────── Sync ─────────────────────────── */

/** Everything changed since a cursor (updated_at), for the app's incremental pull. */
export async function syncSince(env: Env, cursor: string): Promise<{ transactions: TxnRow[]; nextCursor: string }> {
  const res = await env.DB.prepare(
    `SELECT ${TXN_SELECT} WHERE t.updated_at > ? ORDER BY t.updated_at ASC LIMIT 1000`,
  ).bind(cursor).all<TxnRow>();
  const rows = res.results ?? [];
  const nextCursor = rows.length ? rows[rows.length - 1].updated_at : cursor;
  return { transactions: rows, nextCursor };
}

/* ─────────────────────── Learning from corrections ─────────────────────── */

/** Record a re-categorisation and promote a repeat payee to a learned rule. */
export async function learnFromCorrection(
  env: Env,
  txn: TxnRow,
  correctedCategory: string,
): Promise<void> {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO classification_feedback
       (id, txn_id, predicted_category, corrected_category, merchant, merchant_norm, raw_text, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(uid(), txn.id, txn.category, correctedCategory, txn.merchant, txn.merchant_norm, txn.raw_text, ts).run();

  if (txn.merchant_norm) {
    await env.DB.prepare(
      `INSERT INTO merchant_rules (id, pattern, category, source, hit_count, created_at, updated_at)
       VALUES (?,?,?, 'learned', 1, ?, ?)
       ON CONFLICT(pattern) DO UPDATE SET category = excluded.category, hit_count = hit_count + 1, updated_at = excluded.updated_at`,
    ).bind(uid(), txn.merchant_norm, correctedCategory, ts, ts).run();
  }
}

/** A learned/manual override for this payee, if any (checked before rules/LLM). */
export async function lookupMerchantRule(env: Env, merchant: string): Promise<string | null> {
  const pattern = normalizeMerchant(merchant);
  if (!pattern) return null;
  const row = await env.DB.prepare('SELECT category FROM merchant_rules WHERE pattern = ?')
    .bind(pattern).first<{ category: string }>();
  return row?.category ?? null;
}
