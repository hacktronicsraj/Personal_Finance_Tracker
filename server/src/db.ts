import type { Classification, Env, ParsedTxn } from './types';
import { normalizeMerchant } from './classify';
import { NON_SPEND_CATEGORIES } from './categories';

// SQL fragment + binds excluding settlement-style rows (see NON_SPEND_CATEGORIES)
// from every spend aggregate, so a credit-card bill payment never double-counts
// the card spends it settles.
const NON_SPEND_SQL = `category NOT IN (${NON_SPEND_CATEGORIES.map(() => '?').join(',')})`;

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
  merchant_norm?: string | null; // normalizeMerchant(merchant); join key for merchant_alias
  merchant_raw?: string | null; // pre-alias name, kept so the rename UI can show the original
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
      (id, device_id, dedupe_key, raw_text, amount, direction, currency, bank, merchant, merchant_norm,
       account_tail, ref_no, balance, occurred_at, category, confidence, notes, user_note, tags, source,
       corrected, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      normalizeMerchant(cls.merchant || p.merchant || '') || null,
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
    // Sort by the actual transaction date (occurred_at), falling back to when the
    // row was recorded. This puts statement-reconciled / back-dated entries on
    // their real day instead of bunching them under "today".
    ` ORDER BY COALESCE(occurred_at, created_at) DESC, created_at DESC LIMIT ?`;
  binds.push(q.limit ?? 200);
  return { sql, binds };
}

export async function listTxns(env: Env, q: TxnQuery): Promise<TxnRow[]> {
  const { sql, binds } = buildTxnListQuery(q);
  const [{ results }, aliases] = await Promise.all([
    env.DB.prepare(sql).bind(...binds).all<TxnRow>(),
    listAliases(env),
  ]);
  return applyAliases(results ?? [], aliases);
}

/* ─────────────────────────── Merchant aliases ─────────────────────────── */

export interface AliasRow {
  pattern: string;
  display_name: string;
}

/**
 * Nicknames are resolved on READ rather than written onto rows, so naming a payee
 * once renames its whole history and every future payment automatically — and the
 * bank's original name is never destroyed (kept as merchant_raw for the edit UI).
 */
export function applyAliases(rows: TxnRow[], aliases: AliasRow[]): TxnRow[] {
  if (!aliases.length) return rows;
  const byPattern = new Map(aliases.map((a) => [a.pattern, a.display_name]));
  return rows.map((r) => {
    const name = r.merchant_norm ? byPattern.get(r.merchant_norm) : undefined;
    return name ? { ...r, merchant: name, merchant_raw: r.merchant } : r;
  });
}

export async function listAliases(env: Env): Promise<AliasRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT pattern, display_name FROM merchant_alias ORDER BY display_name',
  ).all<AliasRow>();
  return results ?? [];
}

/**
 * Name a payee. The alias is stored against every merchant_norm variant of the
 * same counterparty that already appears in the history — banks truncate payee
 * names (IDBI cuts at 15 chars), so "NINETIES KITCHEN" and "NINETIES KITCHE"
 * arrive as different strings for one shop and both must resolve to the nickname.
 * Returns how many patterns were written.
 */
export async function setAlias(env: Env, merchant: string, displayName: string, now: string): Promise<number> {
  const norm = normalizeMerchant(merchant);
  const name = displayName.trim();
  if (!norm || !name) return 0;

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT merchant_norm FROM transactions
      WHERE merchant_norm IS NOT NULL
        AND ( merchant_norm = ?1
           OR (length(?1)            >= ${MIN_PREFIX} AND merchant_norm LIKE ?1 || '%')
           OR (length(merchant_norm) >= ${MIN_PREFIX} AND ?1 LIKE merchant_norm || '%') )`,
  ).bind(norm).all<{ merchant_norm: string }>();

  const patterns = new Set([norm, ...(results ?? []).map((r) => r.merchant_norm)]);
  for (const p of patterns) {
    await env.DB.prepare(
      `INSERT INTO merchant_alias (pattern, display_name, created_at, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(pattern) DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
    ).bind(p, name, now, now).run();
  }
  return patterns.size;
}

export async function deleteAlias(env: Env, pattern: string): Promise<boolean> {
  const r = await env.DB.prepare('DELETE FROM merchant_alias WHERE pattern = ?').bind(pattern).run();
  return (r.meta?.changes ?? 0) > 0;
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
        'INSERT INTO classification_feedback (id, txn_id, predicted_category, corrected_category, merchant, merchant_norm, raw_text, created_at) VALUES (?,?,?,?,?,?,?,?)',
      )
        .bind(crypto.randomUUID(), id, existing.category, fields.category, existing.merchant, existing.merchant ? normalizeMerchant(existing.merchant) : null, existing.raw_text, now)
        .run();
    }
  }
  if (fields.merchant !== undefined) {
    const m = fields.merchant?.toString().trim() || null;
    sets.push('merchant = ?');
    binds.push(m);
    sets.push('merchant_norm = ?');
    binds.push(m ? normalizeMerchant(m) || null : null);
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
  const where: string[] = ["direction = 'debit'", NON_SPEND_SQL];
  const binds: unknown[] = [...NON_SPEND_CATEGORIES];
  if (from) { where.push('COALESCE(occurred_at, created_at) >= ?'); binds.push(from); }
  if (to) { where.push('COALESCE(occurred_at, created_at) <= ?'); binds.push(to); }
  const sql = `SELECT category, COUNT(*) AS count, SUM(amount) AS total
               FROM transactions WHERE ${where.join(' AND ')}
               GROUP BY category ORDER BY total DESC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results ?? []) as { category: string; count: number; total: number }[];
}

export async function topMerchants(env: Env, from?: string, to?: string, limit = 10) {
  const where: string[] = ["direction = 'debit'", 'merchant IS NOT NULL', NON_SPEND_SQL];
  const binds: unknown[] = [...NON_SPEND_CATEGORIES];
  if (from) { where.push('COALESCE(occurred_at, created_at) >= ?'); binds.push(from); }
  if (to) { where.push('COALESCE(occurred_at, created_at) <= ?'); binds.push(to); }
  // Grouped on the normalized name, not the raw one, so casing/punctuation variants
  // of one payee ("Zepto" vs "ZEPTO") aggregate together and a nickname can replace
  // the whole group. MIN(merchant) is the fallback label when no alias is set.
  const sql = `SELECT COALESCE(merchant_norm, merchant) AS key, MIN(merchant) AS sample,
                      COUNT(*) AS count, SUM(amount) AS total
               FROM transactions WHERE ${where.join(' AND ')}
               GROUP BY key ORDER BY total DESC LIMIT ?`;
  binds.push(limit);
  const [{ results }, aliases] = await Promise.all([
    env.DB.prepare(sql).bind(...binds).all<{ key: string; sample: string; count: number; total: number }>(),
    listAliases(env),
  ]);
  const byPattern = new Map(aliases.map((a) => [a.pattern, a.display_name]));
  return (results ?? []).map((r) => ({
    merchant: byPattern.get(r.key) ?? r.sample,
    count: r.count,
    total: r.total,
  }));
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

/** Shortest prefix that may stand in for a full merchant name — below this,
 *  "SRI" would match every payee starting with those letters. */
const MIN_PREFIX = 8;

/**
 * Look up a rule for a merchant, tolerating the truncation banks apply to payee
 * names. IDBI cuts them to 15 characters, so the same shop arrives as both
 * "NINETIES KITCHEN" and "NINETIES KITCHE" (likewise ROYAL BISON AUTO, ZEPTO
 * MARKETPLACE, ROPPEN TRANSPORTATION). Exact-match lookup treats those as
 * different merchants and re-asks the LLM for one it was already taught.
 *
 * Matches in either direction — the stored rule may be the truncated form or the
 * full one — and prefers an exact hit, then the longest (most specific) prefix.
 */
export async function findRuleForMerchant(env: Env, norm: string) {
  if (!norm) return null;
  return env.DB.prepare(
    `SELECT * FROM merchant_rules
      WHERE pattern = ?1
         OR (length(?1)     >= ${MIN_PREFIX} AND pattern LIKE ?1 || '%')
         OR (length(pattern) >= ${MIN_PREFIX} AND ?1 LIKE pattern || '%')
      ORDER BY (pattern = ?1) DESC, length(pattern) DESC
      LIMIT 1`,
  ).bind(norm).first<{
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

/**
 * Merchant labels that are placeholders rather than real counterparties — a
 * generic card alert with no payee, or parser boilerplate that leaked into the
 * field. They appear against many unrelated categories (the live data has
 * "SuperCard Payment" corrected to six different ones), so a rule keyed on them
 * would mis-file every future card spend. Never learn from these.
 */
const UNLEARNABLE_MERCHANT_RE =
  /^(?:\?|unknown|n\/?a|upi(?: transfer| payment)?|super\s?ca(?:rd)? payment|card payment|payment|dispute call\b.*|to (?:block|dispute)\b.*)$/i;

export function isLearnableMerchant(merchant: string | null | undefined): boolean {
  const m = (merchant ?? '').trim();
  if (m.length < 3) return false;
  if (UNLEARNABLE_MERCHANT_RE.test(m)) return false;
  return /[A-Za-z]{3}/.test(m); // needs real letters, not just a ref number
}

/**
 * Turn a user's re-categorisation into a durable merchant rule.
 *
 * The previous version scanned the 50 most recent feedback rows globally and
 * counted only *consecutive* agreements, so a merchant corrected twice with any
 * other merchant's correction in between never qualified — across 40 real
 * corrections it produced zero rules. Now the merchant's own history is queried
 * directly (via merchant_norm) and judged on a majority:
 *   - no prior conflicting correction  → one correction is enough
 *   - conflicting history              → the new category must hold a strict
 *                                        majority of that merchant's corrections
 */
export async function processLearningLoop(env: Env, merchant: string | null, newCategory: string, now: string) {
  if (!isLearnableMerchant(merchant)) return;
  const norm = normalizeMerchant(merchant!);
  if (!norm) return;

  const rule = await getRuleByPattern(env, norm);
  if (rule && rule.source === 'manual') return; // Do not touch manual rules

  const { results } = await env.DB.prepare(
    'SELECT corrected_category FROM classification_feedback WHERE merchant_norm = ?'
  ).bind(norm).all<{ corrected_category: string }>();

  const tally = new Map<string, number>();
  for (const f of results ?? []) {
    if (!f.corrected_category) continue;
    tally.set(f.corrected_category, (tally.get(f.corrected_category) ?? 0) + 1);
  }
  const agree = tally.get(newCategory) ?? 0;
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  const conflicting = total - agree;

  if (conflicting === 0 || agree > conflicting) {
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

/* ─────────────────────────── Runway ─────────────────────────── */

export interface Runway {
  balance: number | null;
  balanceAsOf: string | null;
  dailyBurn: number;
  spentWindow: number;
  windowDays: number;
  runwayDays: number | null;
}

/**
 * How long the money on hand lasts at the recent burn rate.
 *
 * Balance comes from the bank's own SMS ("Bal Rs 7287.73"), which is the only
 * authoritative figure available — it reflects every movement, including the ones
 * never captured as transactions. Burn is the trailing `windowDays` of debits,
 * excluding non-spend settlements.
 *
 * Caveat worth surfacing in the UI: this is ONE account's balance. Money parked
 * elsewhere is invisible to it, so treat it as a floor, not net worth.
 */
export async function computeRunway(env: Env, nowIso: string, windowDays = 30): Promise<Runway> {
  const since = new Date(new Date(nowIso).getTime() - windowDays * 86400000).toISOString();

  const latest = await env.DB.prepare(
    `SELECT balance, COALESCE(occurred_at, created_at) AS at FROM transactions
      WHERE balance IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  ).first<{ balance: number; at: string }>();

  const spent = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
      WHERE direction = 'debit' AND ${NON_SPEND_SQL}
        AND COALESCE(occurred_at, created_at) >= ?`,
  ).bind(...NON_SPEND_CATEGORIES, since).first<{ total: number }>();

  const spentWindow = spent?.total ?? 0;
  const dailyBurn = spentWindow / windowDays;
  const balance = latest?.balance ?? null;
  // A zero burn would divide to Infinity — report "unknown" instead.
  const runwayDays = balance !== null && dailyBurn > 0 ? Math.floor(balance / dailyBurn) : null;

  return { balance, balanceAsOf: latest?.at ?? null, dailyBurn, spentWindow, windowDays, runwayDays };
}

/* ─────────────────────── Recurring detection ─────────────────────── */

export interface RecurringSuggestion {
  merchant: string;
  pattern: string;
  amount: number;
  dayOfCycle: number;
  frequency: 'monthly' | 'weekly';
  occurrences: number;
  category: string;
  lastSeen: string;
  confidence: number;
}

interface Charge { at: string; amount: number; category: string; merchant: string; autopay?: boolean }

/**
 * A bank alert that names a standing instruction ("...towards Groww for UPI
 * Mandate AutoPay"). The message itself proves a mandate exists, so one sighting
 * is enough — waiting for a second month would hide a live subscription for
 * up to 31 days.
 */
export const AUTOPAY_RE = /\bmandate\s*autopay\b|\bauto\s?pay\b|\be-?nach\b|\bstanding instruction\b|\bsi\s+debit\b/i;

/**
 * Decide whether one payee's charge history looks like a subscription/EMI.
 * Pure so the spacing rules are unit-testable without D1.
 *
 * Requires >= 2 charges, a stable amount (each within 20% of the median), and
 * spacing that clusters near a weekly or monthly period. Monthly is checked by
 * day-of-month agreement rather than raw day-gaps, because month lengths differ
 * and a 28th-of-the-month charge is 28-31 days apart depending on the month.
 */
export function detectRecurring(charges: Charge[]): RecurringSuggestion | null {
  if (charges.length === 0) return null;
  const sorted = [...charges].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted[sorted.length - 1];

  // Self-declared autopay: the SMS says a mandate charged the account, so the
  // spacing evidence the rules below look for is unnecessary.
  if (sorted.some((c) => c.autopay)) {
    const amounts = [...sorted.map((c) => c.amount)].sort((a, b) => a - b);
    return {
      merchant: last.merchant,
      pattern: '',
      amount: amounts[Math.floor(amounts.length / 2)],
      dayOfCycle: new Date(last.at).getUTCDate(),
      frequency: 'monthly',
      occurrences: sorted.length,
      category: last.category,
      lastSeen: last.at,
      confidence: sorted.length > 1 ? 0.9 : 0.7,
    };
  }

  if (charges.length < 2) return null;

  const amounts = [...sorted.map((c) => c.amount)].sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)];
  if (median <= 0) return null;
  if (!sorted.every((c) => Math.abs(c.amount - median) <= median * 0.2)) return null;

  const days = sorted.map((c) => new Date(c.at).getUTCDate());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((new Date(sorted[i].at).getTime() - new Date(sorted[i - 1].at).getTime()) / 86400000);
  }

  // Monthly: every charge lands within 3 days of the same day-of-month, and no two
  // charges sit in the same month (which would make it a burst, not a cycle).
  const dayOfCycle = days[0];
  const sameDay = days.every((d) => {
    let diff = Math.abs(d - dayOfCycle);
    if (diff > 15) diff = 31 - diff; // wrap month boundary
    return diff <= 3;
  });
  const monthlyGaps = gaps.every((g) => g >= 25 && g <= 36);
  if (sameDay && monthlyGaps) {
    return {
      merchant: sorted[sorted.length - 1].merchant,
      pattern: '',
      amount: median,
      dayOfCycle,
      frequency: 'monthly',
      occurrences: sorted.length,
      category: sorted[sorted.length - 1].category,
      lastSeen: sorted[sorted.length - 1].at,
      confidence: Math.min(0.95, 0.6 + 0.15 * (sorted.length - 2)),
    };
  }

  // Weekly: every gap within a day of 7.
  if (gaps.length >= 2 && gaps.every((g) => g >= 6 && g <= 8)) {
    return {
      merchant: sorted[sorted.length - 1].merchant,
      pattern: '',
      amount: median,
      dayOfCycle,
      frequency: 'weekly',
      occurrences: sorted.length,
      category: sorted[sorted.length - 1].category,
      lastSeen: sorted[sorted.length - 1].at,
      confidence: Math.min(0.9, 0.55 + 0.15 * (sorted.length - 2)),
    };
  }
  return null;
}

/**
 * Scan the history for charges that look recurring and are not already tracked as
 * a mandate. Surfaced as suggestions the user accepts, never auto-created — an
 * auto-created mandate that guesses wrong is worse than no mandate.
 */
export async function suggestRecurring(env: Env, lookbackDays = 120): Promise<RecurringSuggestion[]> {
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT merchant, merchant_norm, amount, category, raw_text,
            COALESCE(occurred_at, created_at) AS at
       FROM transactions
      WHERE direction = 'debit' AND merchant IS NOT NULL
        AND COALESCE(occurred_at, created_at) >= ?
      ORDER BY at ASC`,
  ).bind(since).all<{ merchant: string; merchant_norm: string | null; amount: number; category: string; raw_text: string | null; at: string }>();

  const groups = new Map<string, Charge[]>();
  for (const r of results ?? []) {
    const key = r.merchant_norm || normalizeMerchant(r.merchant);
    if (!key || !isLearnableMerchant(r.merchant)) continue;
    const list = groups.get(key) ?? [];
    list.push({
      at: r.at,
      amount: r.amount,
      category: r.category,
      merchant: r.merchant,
      autopay: AUTOPAY_RE.test(r.raw_text ?? ''),
    });
    groups.set(key, list);
  }

  const [mandates, aliases] = await Promise.all([listMandates(env), listAliases(env)]);
  const byPattern = new Map(aliases.map((a) => [a.pattern, a.display_name]));

  const out: RecurringSuggestion[] = [];
  for (const [key, charges] of groups) {
    const hit = detectRecurring(charges);
    if (!hit) continue;
    // Skip anything an existing mandate already covers.
    const covered = mandates.some((m) =>
      mandateMatches(m, { merchant: hit.merchant, amount: hit.amount, dayOfMonth: hit.dayOfCycle }),
    );
    if (covered) continue;
    out.push({ ...hit, pattern: key, merchant: byPattern.get(key) ?? hit.merchant });
  }
  return out.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
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

/** Most recent report; pass `type` ('weekly'|'monthly') to scope to one kind so
 * the weekly notification never resolves to a monthly report (or vice-versa). */
export async function latestReport(env: Env, type?: string): Promise<ReportRow | null> {
  if (type) {
    return env.DB.prepare(
      'SELECT * FROM reports WHERE period_type = ? ORDER BY period_end DESC, created_at DESC LIMIT 1',
    ).bind(type).first<ReportRow>();
  }
  return env.DB.prepare('SELECT * FROM reports ORDER BY period_end DESC, created_at DESC LIMIT 1').first<ReportRow>();
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
  const where: string[] = ["direction = 'debit'", 'tags IS NOT NULL', NON_SPEND_SQL];
  const binds: unknown[] = [...NON_SPEND_CATEGORIES];
  if (from) { where.push('COALESCE(occurred_at, created_at) >= ?'); binds.push(from); }
  if (to) { where.push('COALESCE(occurred_at, created_at) <= ?'); binds.push(to); }
  const sql = `SELECT json_each.value AS tag, COUNT(*) AS count, SUM(amount) AS total
               FROM transactions, json_each(tags)
               WHERE ${where.join(' AND ')}
               GROUP BY json_each.value ORDER BY total DESC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results ?? []) as { tag: string; count: number; total: number }[];
}
