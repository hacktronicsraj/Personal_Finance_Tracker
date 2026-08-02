import type { Classification, Env, ParsedTxn } from './types';
import { normalizeMerchant } from './classify';

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
  user_note: string | null;
  tags: string | null; // JSON array string e.g. '["trip","work"]'
  mandate_id: string | null; // set by mandate auto-match (F1)
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
    note?: string;
    tags?: string[];
  },
): Promise<TxnRow> {
  const id = crypto.randomUUID();
  const { parsed: p, cls } = args;
  const cleanTags = args.tags?.map((t) => t.trim()).filter(Boolean) ?? [];
  await env.DB.prepare(
    `INSERT INTO transactions
      (id, device_id, dedupe_key, raw_text, amount, direction, currency, bank, merchant,
       account_tail, ref_no, balance, occurred_at, category, confidence, notes, user_note, tags, source,
       corrected, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      args.note?.trim() || null,
      cleanTags.length ? JSON.stringify(cleanTags) : null,
      args.source ?? 'sms',
      args.corrected ?? 0,
      args.now,
      args.now,
    )
    .run();
  return (await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TxnRow>())!;
}

export interface TxnQuery {
  from?: string; to?: string; category?: string; categories?: string[]; search?: string;
  limit?: number; minAmount?: number; maxAmount?: number; source?: string; tag?: string;
}

/**
 * Pure SQL builder for the transactions list — kept separate from execution so
 * the filter matrix (amount bounds, source, tag, multi-category) is unit-testable
 * without a live D1. Returns the parameterised SQL and its ordered binds.
 */
export function buildTxnListQuery(q: TxnQuery): { sql: string; binds: unknown[] } {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.from) { where.push('COALESCE(occurred_at, created_at) >= ?'); binds.push(q.from); }
  if (q.to) { where.push('COALESCE(occurred_at, created_at) <= ?'); binds.push(q.to); }
  // `categories` (multi-select) supersedes the single `category` when non-empty.
  if (q.categories && q.categories.length > 0) {
    where.push(`category IN (${q.categories.map(() => '?').join(',')})`);
    binds.push(...q.categories);
  } else if (q.category) {
    where.push('category = ?'); binds.push(q.category);
  }
  if (q.search) { where.push('(merchant LIKE ? OR raw_text LIKE ?)'); binds.push(`%${q.search}%`, `%${q.search}%`); }
  if (typeof q.minAmount === 'number') { where.push('amount >= ?'); binds.push(q.minAmount); }
  if (typeof q.maxAmount === 'number') { where.push('amount <= ?'); binds.push(q.maxAmount); }
  if (q.source) { where.push('source = ?'); binds.push(q.source); }
  if (q.tag) { where.push('EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)'); binds.push(q.tag); }
  const sql =
    `SELECT * FROM transactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''}` +
    // Sort by when the row was recorded, not the (possibly back-dated) txn date, so
    // a just-added entry always lands at the top of the list.
    ` ORDER BY created_at DESC LIMIT ?`;
  binds.push(q.limit ?? 200);
  return { sql, binds };
}

export async function listTxns(env: Env, q: TxnQuery): Promise<TxnRow[]> {
  const { sql, binds } = buildTxnListQuery(q);
  const { results } = await env.DB.prepare(sql).bind(...binds).all<TxnRow>();
  return results ?? [];
}

/** Link a debit to the mandate it satisfied. Idempotent per (txn, mandate). */
export async function linkMandate(env: Env, txnId: string, mandateId: string, now: string): Promise<void> {
  await env.DB.prepare('UPDATE transactions SET mandate_id = ?, updated_at = ? WHERE id = ?')
    .bind(mandateId, now, txnId)
    .run();
}

/**
 * Apply a user edit to a transaction. Any subset of {category, merchant, amount,
 * note} may be provided. A category change is recorded as classifier feedback.
 * Any edit marks the row corrected so it's treated as user-confirmed.
 */
export async function updateTransaction(
  env: Env,
  id: string,
  fields: { category?: string; merchant?: string | null; amount?: number; note?: string | null; tags?: string[] },
  now: string,
): Promise<TxnRow | null> {
  const existing = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TxnRow>();
  if (!existing) return null;

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (fields.category !== undefined) {
    sets.push('category = ?', 'confidence = 1.0');
    binds.push(fields.category);
    if (fields.category !== existing.category) {
      await env.DB.prepare(
        'INSERT INTO classification_feedback (id, txn_id, predicted_category, corrected_category, merchant, raw_text, created_at) VALUES (?,?,?,?,?,?,?)',
      )
        .bind(crypto.randomUUID(), id, existing.category, fields.category, existing.merchant, existing.raw_text, now)
        .run();
    }
  }
  if (fields.merchant !== undefined) {
    sets.push('merchant = ?');
    binds.push(fields.merchant?.toString().trim() || null);
  }
  if (typeof fields.amount === 'number' && Number.isFinite(fields.amount) && fields.amount > 0) {
    sets.push('amount = ?');
    binds.push(fields.amount);
  }
  if (fields.note !== undefined) {
    sets.push('user_note = ?');
    binds.push(fields.note?.toString().trim() || null);
  }
  if (fields.tags !== undefined) {
    sets.push('tags = ?');
    binds.push(fields.tags.length > 0 ? JSON.stringify(fields.tags) : null);
  }
  if (sets.length === 0) return existing;

  sets.push('corrected = 1', 'updated_at = ?');
  binds.push(now);
  await env.DB.prepare(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
  return env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(id).first<TxnRow>();
}

/** Delete a transaction (and any cross-source merge aliases pointing at it). */
export async function deleteTransaction(env: Env, id: string): Promise<boolean> {
  const existing = await env.DB.prepare('SELECT id FROM transactions WHERE id = ?').bind(id).first();
  if (!existing) return false;
  await env.DB.prepare('DELETE FROM dedupe_alias WHERE txn_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  return true;
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
  if (from) { where.push('COALESCE(occurred_at, created_at) >= ?'); binds.push(from); }
  if (to) { where.push('COALESCE(occurred_at, created_at) <= ?'); binds.push(to); }
  const sql = `SELECT category, COUNT(*) AS count, SUM(amount) AS total
               FROM transactions WHERE ${where.join(' AND ')}
               GROUP BY category ORDER BY total DESC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results ?? []) as { category: string; count: number; total: number }[];
}

export async function topMerchants(env: Env, from?: string, to?: string, limit = 10) {
  const where: string[] = ["direction = 'debit'", 'merchant IS NOT NULL'];
  const binds: unknown[] = [];
  if (from) { where.push('COALESCE(occurred_at, created_at) >= ?'); binds.push(from); }
  if (to) { where.push('COALESCE(occurred_at, created_at) <= ?'); binds.push(to); }
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

export async function getRuleByPattern(env: Env, pattern: string) {
  return env.DB.prepare('SELECT * FROM merchant_rules WHERE pattern = ?').bind(pattern).first<{
    id: string; pattern: string; category: string; source: string; hit_count: number;
  }>();
}

export async function incrementRuleHit(env: Env, id: string) {
  await env.DB.prepare('UPDATE merchant_rules SET hit_count = hit_count + 1 WHERE id = ?').bind(id).run();
}

export async function listRules(env: Env) {
  const { results } = await env.DB.prepare('SELECT * FROM merchant_rules ORDER BY created_at DESC').all();
  return results ?? [];
}

export async function upsertRule(env: Env, pattern: string, category: string, source: 'learned' | 'manual', now: string) {
  const existing = await env.DB.prepare('SELECT id, source FROM merchant_rules WHERE pattern = ?').bind(pattern).first<{id: string, source: string}>();
  if (existing) {
    if (existing.source === 'manual' && source === 'learned') return; // Don't overwrite manual rules with learned ones
    await env.DB.prepare('UPDATE merchant_rules SET category = ?, source = ?, updated_at = ? WHERE id = ?')
      .bind(category, source, now, existing.id).run();
  } else {
    await env.DB.prepare('INSERT INTO merchant_rules (id, pattern, category, source, hit_count, created_at, updated_at) VALUES (?,?,?,?,0,?,?)')
      .bind(crypto.randomUUID(), pattern, category, source, now, now).run();
  }
}

export async function deleteRule(env: Env, id: string) {
  await env.DB.prepare('DELETE FROM merchant_rules WHERE id = ?').bind(id).run();
}

export async function updateRuleCategory(env: Env, id: string, category: string, now: string) {
  await env.DB.prepare('UPDATE merchant_rules SET category = ?, updated_at = ? WHERE id = ?').bind(category, now, id).run();
}

export async function processLearningLoop(env: Env, merchant: string | null, newCategory: string, now: string) {
  if (!merchant) return;
  const norm = normalizeMerchant(merchant);
  if (!norm) return;

  const rule = await getRuleByPattern(env, norm);
  if (rule && rule.source === 'manual') return; // Do not touch manual rules

  // Get recent feedbacks for this normalized merchant
  // We don't store normalized merchant in classification_feedback, but we can just query feedbacks matching the exact unnormalized merchant,
  // or better, fetch recent feedbacks and filter by normalized merchant.
  const { results } = await env.DB.prepare(
    'SELECT corrected_category, merchant FROM classification_feedback ORDER BY created_at DESC LIMIT 50'
  ).all<{corrected_category: string; merchant: string}>();

  let consistentCount = 0;
  for (const f of results ?? []) {
    if (normalizeMerchant(f.merchant) === norm) {
      if (f.corrected_category === newCategory) {
        consistentCount++;
      } else {
        break; // Stop counting if we hit a different category
      }
    }
  }

  // If >= 2 consistent corrections, upsert the rule (flips it if it exists and was contested)
  if (consistentCount >= 2) {
    await upsertRule(env, norm, newCategory, 'learned', now);
  }
}

/* ─────────────────────────── Mandates ─────────────────────────── */

export interface MandateRow {
  id: string;
  name: string;
  platform: string;
  amount: number;
  day_of_cycle: number;
  frequency: string;
  category: string;
  merchant_hint: string | null;
  active: number;
  notes: string | null;
  emi_total: number | null; // tenure (installment count); NULL = open-ended mandate
  emi_start: string | null; // ISO date of first installment (EMI only)
  created_at: string;
  updated_at: string;
}

export async function listMandates(env: Env): Promise<MandateRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM mandates ORDER BY name ASC').all<MandateRow>();
  return results ?? [];
}

export async function getMandate(env: Env, id: string): Promise<MandateRow | null> {
  return env.DB.prepare('SELECT * FROM mandates WHERE id = ?').bind(id).first<MandateRow>();
}

export async function insertMandate(
  env: Env,
  data: {
    name: string;
    platform: string;
    amount: number;
    day_of_cycle: number;
    frequency?: string;
    category?: string;
    merchant_hint?: string;
    notes?: string;
    emi_total?: number | null;
    emi_start?: string | null;
  },
  now: string,
): Promise<MandateRow> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO mandates
       (id, name, platform, amount, day_of_cycle, frequency, category, merchant_hint, active, notes, emi_total, emi_start, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?)`,
  )
    .bind(
      id,
      data.name,
      data.platform,
      data.amount,
      data.day_of_cycle,
      data.frequency ?? 'monthly',
      data.category ?? 'Bills & Utilities',
      data.merchant_hint ?? null,
      data.notes ?? null,
      data.emi_total ?? null,
      data.emi_start ?? null,
      now,
      now,
    )
    .run();
  return (await env.DB.prepare('SELECT * FROM mandates WHERE id = ?').bind(id).first<MandateRow>())!;
}

export async function updateMandate(
  env: Env,
  id: string,
  fields: Partial<Pick<MandateRow, 'name' | 'platform' | 'amount' | 'day_of_cycle' | 'frequency' | 'category' | 'merchant_hint' | 'active' | 'notes' | 'emi_total' | 'emi_start'>>,
  now: string,
): Promise<MandateRow | null> {
  const existing = await getMandate(env, id);
  if (!existing) return null;

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (fields.name !== undefined)          { sets.push('name = ?');          binds.push(fields.name); }
  if (fields.platform !== undefined)      { sets.push('platform = ?');      binds.push(fields.platform); }
  if (fields.amount !== undefined)        { sets.push('amount = ?');        binds.push(fields.amount); }
  if (fields.day_of_cycle !== undefined)  { sets.push('day_of_cycle = ?');  binds.push(fields.day_of_cycle); }
  if (fields.frequency !== undefined)     { sets.push('frequency = ?');     binds.push(fields.frequency); }
  if (fields.category !== undefined)      { sets.push('category = ?');      binds.push(fields.category); }
  if (fields.merchant_hint !== undefined) { sets.push('merchant_hint = ?'); binds.push(fields.merchant_hint); }
  if (fields.active !== undefined)        { sets.push('active = ?');        binds.push(fields.active); }
  if (fields.notes !== undefined)         { sets.push('notes = ?');         binds.push(fields.notes); }
  if (fields.emi_total !== undefined)     { sets.push('emi_total = ?');     binds.push(fields.emi_total); }
  if (fields.emi_start !== undefined)     { sets.push('emi_start = ?');     binds.push(fields.emi_start); }

  if (sets.length === 0) return existing;

  sets.push('updated_at = ?');
  binds.push(now);
  await env.DB.prepare(`UPDATE mandates SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds, id)
    .run();
  return env.DB.prepare('SELECT * FROM mandates WHERE id = ?').bind(id).first<MandateRow>();
}

export async function deleteMandate(env: Env, id: string): Promise<boolean> {
  const existing = await env.DB.prepare('SELECT id FROM mandates WHERE id = ?').bind(id).first();
  if (!existing) return false;
  await env.DB.prepare('DELETE FROM mandates WHERE id = ?').bind(id).run();
  return true;
}

/**
 * Pure match predicate — does this debit satisfy the mandate's window?
 *   - amount within ±20% of the expected charge
 *   - day of month within ±3 days of day_of_cycle (wraps at month boundaries)
 *   - merchant_hint (substring, either direction) OR any name token (≥3 chars) hits merchant
 * Extracted from findMandateMatch so the window is unit-testable without D1.
 */
export function mandateMatches(
  m: Pick<MandateRow, 'name' | 'amount' | 'day_of_cycle' | 'merchant_hint'>,
  txn: { merchant: string; amount: number; dayOfMonth: number },
): boolean {
  // Amount check: within ±20%
  if (txn.amount < m.amount * 0.8 || txn.amount > m.amount * 1.2) return false;

  // Day-of-cycle check: within ±3 days (wrapping around month boundaries)
  let dayDiff = Math.abs(txn.dayOfMonth - m.day_of_cycle);
  if (dayDiff > 15) dayDiff = 31 - dayDiff; // wrap around month boundary
  if (dayDiff > 3) return false;

  // Merchant check: merchant_hint substring match OR any token of name matches
  const merchantLower = txn.merchant.toLowerCase();
  if (m.merchant_hint) {
    const hint = m.merchant_hint.toLowerCase();
    if (merchantLower.includes(hint) || hint.includes(merchantLower)) return true;
  }
  return m.name
    .toLowerCase()
    .split(/\s+/)
    .some((tok) => tok.length >= 3 && merchantLower.includes(tok));
}

/**
 * Find an active mandate that likely matches an incoming debit transaction.
 */
export async function findMandateMatch(
  env: Env,
  merchant: string | null,
  amount: number,
  dayOfMonth: number,
): Promise<MandateRow | null> {
  if (!merchant) return null;

  const { results } = await env.DB.prepare(
    'SELECT * FROM mandates WHERE active = 1',
  ).all<MandateRow>();

  for (const m of results ?? []) {
    if (mandateMatches(m, { merchant, amount, dayOfMonth })) return m;
  }
  return null;
}

/* ─────────────────────────── Reports (M7) ─────────────────────────── */

export interface ReportRow {
  id: string;
  period_start: string;
  period_end: string;
  period_type: string; // 'weekly' | 'monthly'
  summary_json: string | null;
  html: string | null;
  created_at: string;
}

export async function insertReport(
  env: Env,
  r: { periodStart: string; periodEnd: string; summaryJson: string; html: string; periodType?: string },
  now: string,
): Promise<ReportRow> {
  const id = crypto.randomUUID();
  const type = r.periodType ?? 'weekly';
  // One report per (type, period): regenerating a period replaces the old row
  // instead of stacking duplicates in the list.
  await env.DB.prepare('DELETE FROM reports WHERE period_type = ? AND period_start = ? AND period_end = ?')
    .bind(type, r.periodStart, r.periodEnd).run();
  await env.DB.prepare(
    'INSERT INTO reports (id, period_start, period_end, period_type, summary_json, html, created_at) VALUES (?,?,?,?,?,?,?)',
  ).bind(id, r.periodStart, r.periodEnd, type, r.summaryJson, r.html, now).run();
  return { id, period_start: r.periodStart, period_end: r.periodEnd, period_type: type, summary_json: r.summaryJson, html: r.html, created_at: now };
}

/** Report metadata list (no HTML payload — the list screen only needs periods). */
export async function listReports(env: Env): Promise<Omit<ReportRow, 'html'>[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, period_start, period_end, period_type, summary_json, created_at FROM reports ORDER BY period_end DESC, created_at DESC LIMIT 52',
  ).all<Omit<ReportRow, 'html'>>();
  return results ?? [];
}

export async function getReport(env: Env, id: string): Promise<ReportRow | null> {
  return env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportRow>();
}

export async function latestReport(env: Env): Promise<ReportRow | null> {
  return env.DB.prepare('SELECT * FROM reports ORDER BY period_end DESC LIMIT 1').first<ReportRow>();
}

/* ─────────────────────────── Attachments (M6) ─────────────────────────── */

export interface AttachmentRow {
  id: string;
  txn_id: string;
  r2_key: string;
  mime: string | null;
  size: number | null;
  created_at: string;
}

export async function insertAttachment(
  env: Env,
  a: { txnId: string; r2Key: string; mime: string | null; size: number | null },
  now: string,
): Promise<AttachmentRow> {
  const id = a.r2Key.split('/').pop()!;
  await env.DB.prepare(
    'INSERT INTO attachments (id, txn_id, r2_key, mime, size, created_at) VALUES (?,?,?,?,?,?)',
  ).bind(id, a.txnId, a.r2Key, a.mime, a.size, now).run();
  return { id, txn_id: a.txnId, r2_key: a.r2Key, mime: a.mime, size: a.size, created_at: now };
}

export async function listAttachments(env: Env, txnId: string): Promise<AttachmentRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM attachments WHERE txn_id = ? ORDER BY created_at ASC',
  ).bind(txnId).all<AttachmentRow>();
  return results ?? [];
}

export async function getAttachment(env: Env, id: string): Promise<AttachmentRow | null> {
  return env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<AttachmentRow>();
}

/** Delete an attachment's R2 object + row. Returns the row (or null if absent). */
export async function deleteAttachment(env: Env, id: string): Promise<AttachmentRow | null> {
  const row = await getAttachment(env, id);
  if (!row) return null;
  await env.ATTACHMENTS.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM attachments WHERE id = ?').bind(id).run();
  return row;
}

/** Cascade: remove every attachment (R2 + rows) belonging to a transaction. */
export async function deleteAttachmentsForTxn(env: Env, txnId: string): Promise<void> {
  const rows = await listAttachments(env, txnId);
  for (const r of rows) await env.ATTACHMENTS.delete(r.r2_key);
  if (rows.length) await env.DB.prepare('DELETE FROM attachments WHERE txn_id = ?').bind(txnId).run();
}

export async function tagAnalytics(env: Env, from?: string, to?: string) {
  const where: string[] = ["direction = 'debit'", 'tags IS NOT NULL'];
  const binds: unknown[] = [];
  if (from) { where.push('COALESCE(occurred_at, created_at) >= ?'); binds.push(from); }
  if (to) { where.push('COALESCE(occurred_at, created_at) <= ?'); binds.push(to); }
  const sql = `SELECT json_each.value AS tag, COUNT(*) AS count, SUM(amount) AS total
               FROM transactions, json_each(tags)
               WHERE ${where.join(' AND ')}
               GROUP BY json_each.value ORDER BY total DESC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results ?? []) as { tag: string; count: number; total: number }[];
}
