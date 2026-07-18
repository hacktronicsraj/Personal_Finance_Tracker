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
  notes        TEXT,                 -- classifier notes (rule:/llm:) — not user-facing
  user_note    TEXT,                 -- optional free-text the user adds/edits
  tags         TEXT,                 -- JSON array of user tags e.g. '["trip","work"]'
  mandate_id   TEXT,                 -- links a debit to the mandate it satisfied (F1 auto-match)
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

CREATE TABLE IF NOT EXISTS merchant_rules (
  id         TEXT PRIMARY KEY,
  pattern    TEXT NOT NULL UNIQUE,
  category   TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('learned','manual')),
  hit_count  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mandates (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('gpay','phonepe','paytm','bank_autopay','card','other')),
  amount        REAL NOT NULL,
  day_of_cycle  INTEGER NOT NULL,
  frequency     TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  category      TEXT NOT NULL DEFAULT 'Bills & Utilities',
  merchant_hint TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Receipt attachments (M6). Bytes live in R2 (key = txn/<txn_id>/<id>); this row
-- is the metadata index. Cascade-deleted with the parent transaction.
CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  txn_id     TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  mime       TEXT,
  size       INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attach_txn ON attachments (txn_id);

-- Digest reports (M7 weekly + monthly). Pre-rendered HTML + the structured JSON
-- it came from.
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  period_type  TEXT NOT NULL DEFAULT 'weekly',  -- 'weekly' | 'monthly'
  summary_json TEXT,
  html         TEXT,
  created_at   TEXT NOT NULL
);
