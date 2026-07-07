-- Cloudflare D1 schema for Personal Finance Tracker

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  icon       TEXT,
  color      TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  device_id    TEXT,
  dedupe_key   TEXT UNIQUE,
  raw_text     TEXT NOT NULL,
  amount       REAL NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  currency     TEXT NOT NULL DEFAULT 'INR',
  bank         TEXT,
  merchant     TEXT,
  account_tail TEXT,
  ref_no       TEXT,
  balance      REAL,
  occurred_at  TEXT,                 -- ISO-8601
  category     TEXT NOT NULL DEFAULT 'Other',
  confidence   REAL NOT NULL DEFAULT 0,
  notes        TEXT,
  source       TEXT NOT NULL DEFAULT 'sms',
  corrected    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,        -- ISO-8601
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txn_occurred ON transactions (occurred_at);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions (category);
CREATE INDEX IF NOT EXISTS idx_txn_updated  ON transactions (updated_at);

-- Maps a secondary event's dedupe_key to the transaction it was merged into, so a
-- retried GPay/SMS event that already merged resolves to the same row (idempotent
-- cross-source merge) instead of inserting a duplicate.
CREATE TABLE IF NOT EXISTS dedupe_alias (
  dedupe_key TEXT PRIMARY KEY,
  txn_id     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classification_feedback (
  id                  TEXT PRIMARY KEY,
  txn_id              TEXT,
  predicted_category  TEXT,
  corrected_category  TEXT,
  merchant            TEXT,
  raw_text            TEXT,
  created_at          TEXT NOT NULL
);

-- Seed the standard taxonomy (id = slug).
INSERT OR IGNORE INTO categories (id, name, icon, color, is_default) VALUES
  ('food',          'Food & Dining',     'restaurant',    '#ef4444', 1),
  ('groceries',     'Groceries',         'basket',        '#f59e0b', 1),
  ('transport',     'Transport',         'car',           '#3b82f6', 1),
  ('shopping',      'Shopping',          'bag',           '#8b5cf6', 1),
  ('bills',         'Bills & Utilities', 'flash',         '#14b8a6', 1),
  ('entertainment', 'Entertainment',     'film',          '#ec4899', 1),
  ('health',        'Health',            'medkit',        '#10b981', 1),
  ('transfers',     'Transfers',         'swap-horizontal','#6b7280', 1),
  ('income',        'Income',            'cash',          '#22c55e', 1),
  ('other',         'Other',             'ellipsis-horizontal', '#94a3b8', 1);
