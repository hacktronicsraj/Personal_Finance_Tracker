import * as SQLite from 'expo-sqlite';
import type { TxnRow } from '../api/client';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('pft.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      raw_text TEXT, amount REAL, direction TEXT, currency TEXT,
      bank TEXT, merchant TEXT, account_tail TEXT, ref_no TEXT, balance REAL,
      occurred_at TEXT, category TEXT, confidence REAL, notes TEXT, user_note TEXT,
      tags TEXT, mandate_id TEXT, source TEXT,
      corrected INTEGER, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS outbox (
      dedupe_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS review_queue (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      sender TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS merchant_rules (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Migrations: add columns to caches created before they existed. Guarded by
  // PRAGMA table_info since SQLite's ADD COLUMN has no IF NOT EXISTS.
  const cols = await _db.getAllAsync<{ name: string }>(`PRAGMA table_info(transactions)`);
  const have = new Set(cols.map((c) => c.name));
  for (const [col, ddl] of [
    ['user_note', 'user_note TEXT'],
    ['tags', 'tags TEXT'],
    ['mandate_id', 'mandate_id TEXT'],
    ['source', 'source TEXT'],
  ] as const) {
    if (!have.has(col)) await _db.execAsync(`ALTER TABLE transactions ADD COLUMN ${ddl}`);
  }
  const uvRow = await _db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (uvRow && uvRow.user_version < 2) {
    await _db.execAsync('PRAGMA user_version = 2');
  }
  return _db;
}

// ---- Review queue (SMS that looked financial but we couldn't parse — surfaced
//      for manual completion instead of being silently dropped) ----
export interface ReviewItem {
  id: string;
  raw_text: string;
  sender: string | null;
  source: string | null;
  created_at: string;
}

// Stable id from the message text so re-scanning the inbox doesn't re-queue it.
function reviewId(rawText: string): string {
  let h = 5381;
  for (let i = 0; i < rawText.length; i++) h = ((h << 5) + h + rawText.charCodeAt(i)) | 0;
  return `rv-${(h >>> 0).toString(36)}`;
}

export async function addReview(rawText: string, sender?: string, source = 'sms'): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO review_queue (id, raw_text, sender, source, created_at) VALUES (?,?,?,?,?)`,
    [reviewId(rawText), rawText, sender ?? null, source, new Date().toISOString()],
  );
}
export async function listReviews(): Promise<ReviewItem[]> {
  const db = await getDb();
  return db.getAllAsync<ReviewItem>(`SELECT * FROM review_queue ORDER BY created_at DESC`);
}
export async function countReviews(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM review_queue`);
  return row?.n ?? 0;
}
export async function removeReview(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM review_queue WHERE id = ?`, [id]);
}

export async function upsertTxn(row: TxnRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO transactions
      (id, raw_text, amount, direction, currency, bank, merchant, account_tail, ref_no,
       balance, occurred_at, category, confidence, notes, user_note, tags, mandate_id, source,
       corrected, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       category=excluded.category, confidence=excluded.confidence, notes=excluded.notes,
       user_note=excluded.user_note, tags=excluded.tags, mandate_id=excluded.mandate_id,
       source=excluded.source, amount=excluded.amount,
       corrected=excluded.corrected, updated_at=excluded.updated_at, merchant=excluded.merchant`,
    [
      row.id, row.raw_text, row.amount, row.direction, row.currency, row.bank, row.merchant,
      row.account_tail, row.ref_no, row.balance, row.occurred_at, row.category, row.confidence,
      row.notes, row.user_note, row.tags ?? null, row.mandate_id ?? null, row.source ?? null,
      row.corrected, row.created_at, row.updated_at,
    ],
  );
}

export async function deleteTxn(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM transactions WHERE id = ?`, [id]);
}

export async function getCachedTxns(limit = 200): Promise<TxnRow[]> {
  const db = await getDb();
  return db.getAllAsync<TxnRow>(
    // Match the server: order by when it was recorded, so newly-added (even
    // back-dated) entries appear first.
    `SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

export async function getCachedTxn(id: string): Promise<TxnRow | null> {
  const db = await getDb();
  return db.getFirstAsync<TxnRow>(`SELECT * FROM transactions WHERE id = ?`, [id]);
}

/** Distinct tags seen across cached transactions — offline autocomplete source. */
export async function getAllCachedTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ tags: string | null }>(
    `SELECT tags FROM transactions WHERE tags IS NOT NULL`,
  );
  const set = new Set<string>();
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.tags ?? '[]');
      if (Array.isArray(arr)) for (const t of arr) if (typeof t === 'string') set.add(t);
    } catch {
      /* ignore malformed */
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function setLocalCategory(id: string, category: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE transactions SET category = ?, corrected = 1 WHERE id = ?`, [category, id]);
}

// ---- Generic key/value (reuses the meta table) ----
export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [key]);
  return row?.value ?? null;
}
export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [key, value, value]);
}

// ---- Sync cursor ----
export async function getCursor(): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM meta WHERE key = 'cursor'`);
  return row?.value ?? '1970-01-01T00:00:00.000Z';
}
export async function setCursor(cursor: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`INSERT INTO meta (key, value) VALUES ('cursor', ?) ON CONFLICT(key) DO UPDATE SET value = ?`, [cursor, cursor]);
}

// ---- Offline outbox ----
export async function queueOutbox(dedupeKey: string, payload: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO outbox (dedupe_key, payload, created_at) VALUES (?,?,?)`,
    [dedupeKey, JSON.stringify(payload), new Date().toISOString()],
  );
}
export async function readOutbox(): Promise<{ dedupe_key: string; payload: string }[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT dedupe_key, payload FROM outbox ORDER BY created_at ASC`);
}
export async function removeOutbox(dedupeKey: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM outbox WHERE dedupe_key = ?`, [dedupeKey]);
}
