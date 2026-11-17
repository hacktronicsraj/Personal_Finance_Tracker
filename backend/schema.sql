-- D1 schema for the native app's backend (pft-native).
-- Focused finance core; grows with the app's phases.

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  icon       TEXT,
  color      TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
  id            TEXT PRIMARY KEY,
  device_id     TEXT,
  dedupe_key    TEXT UNIQUE,
  raw_text      TEXT NOT NULL,
  amount        REAL NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  currency      TEXT NOT NULL DEFAULT 'INR',
  bank          TEXT,
  merchant      TEXT,
  account_tail  TEXT,
  ref_no        TEXT,
  balance       REAL,
  occurred_at   TEXT,                 -- ISO-8601 when the payment happened
  category      TEXT NOT NULL DEFAULT 'Other',
  confidence    REAL NOT NULL DEFAULT 0,
  notes         TEXT,                 -- classifier notes (rule:/llm:) — not user-facing
  user_note     TEXT,                 -- optional free text the user adds
  tags          TEXT,                 -- JSON array e.g. '["trip","work"]'
  merchant_norm TEXT,                 -- normalizeMerchant(merchant); alias join key
  source        TEXT NOT NULL DEFAULT 'sms',  -- sms | shared | manual
  corrected     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txn_occurred ON transactions (occurred_at);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions (category);
CREATE INDEX IF NOT EXISTS idx_txn_updated  ON transactions (updated_at);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions (merchant_norm);

-- User-chosen display names for payees. Resolved on read, so naming one payee
-- renames its whole history and every future payment (keyed by merchant_norm).
CREATE TABLE IF NOT EXISTS merchant_alias (
  pattern      TEXT PRIMARY KEY,     -- normalizeMerchant(merchant)
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Idempotent cross-source merge: a retried event resolves to the row it merged
-- into instead of inserting a duplicate.
CREATE TABLE IF NOT EXISTS dedupe_alias (
  dedupe_key TEXT PRIMARY KEY,
  txn_id     TEXT NOT NULL
);

-- Learned/manual merchant→category overrides (highest-priority classifier input).
CREATE TABLE IF NOT EXISTS merchant_rules (
  id         TEXT PRIMARY KEY,
  pattern    TEXT NOT NULL UNIQUE,   -- normalizeMerchant(merchant)
  category   TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('learned','manual')),
  hit_count  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every user re-categorisation, so the classifier can learn repeat payees.
CREATE TABLE IF NOT EXISTS classification_feedback (
  id                 TEXT PRIMARY KEY,
  txn_id             TEXT,
  predicted_category TEXT,
  corrected_category TEXT,
  merchant           TEXT,
  merchant_norm      TEXT,
  raw_text           TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_merchant ON classification_feedback (merchant_norm);

-- Standard taxonomy (id = slug).
INSERT OR IGNORE INTO categories (id, name, icon, color, is_default) VALUES
  ('food',          'Food & Dining',       'restaurant',           '#ef4444', 1),
  ('groceries',     'Groceries',           'basket',               '#f59e0b', 1),
  ('transport',     'Transport',           'car',                  '#3b82f6', 1),
  ('shopping',      'Shopping',            'bag',                  '#8b5cf6', 1),
  ('bills',         'Bills & Utilities',   'flash',                '#14b8a6', 1),
  ('entertainment', 'Entertainment',       'film',                 '#ec4899', 1),
  ('health',        'Health',              'medkit',               '#10b981', 1),
  ('transfers',     'Transfers',           'swap-horizontal',      '#6b7280', 1),
  ('card-payment',  'Card Payment',        'card',                 '#a1a1aa', 1),
  ('income',        'Income',              'cash',                 '#22c55e', 1),
  ('other',         'Other',               'ellipsis-horizontal',  '#94a3b8', 1);

-- Flashcards that feed the Instagram gate.
CREATE TABLE IF NOT EXISTS flashcards (
  id            TEXT PRIMARY KEY,
  question      TEXT NOT NULL,
  options       TEXT NOT NULL,        -- JSON array of 4 strings
  answer        INTEGER NOT NULL,     -- 0..3
  difficulty    TEXT NOT NULL DEFAULT 'medium',
  deck          TEXT NOT NULL DEFAULT 'default',  -- which subject/library a card belongs to
  source_url    TEXT,
  content_hash  TEXT,                 -- hash(question+options) — bulk-import dedupe
  times_shown   INTEGER NOT NULL DEFAULT 0,
  times_correct INTEGER NOT NULL DEFAULT 0,
  last_shown_at TEXT,                 -- spacing: last time this card appeared in a quiz
  -- Spaced repetition (SM-2). See reviewCard() in assistantDb.ts.
  ease          REAL    NOT NULL DEFAULT 2.5,   -- ease factor, floor 1.3
  interval_days REAL    NOT NULL DEFAULT 0,     -- current gap between reviews
  reps          INTEGER NOT NULL DEFAULT 0,     -- consecutive correct reviews
  due_at        TEXT,                           -- when the card is next due
  grp           TEXT,                           -- sibling group (e.g. 'geo:FR'): never quizzed together
  introduced_at TEXT,                           -- first graded — counts against the new-cards/day cap
  new_order     INTEGER,                        -- introduction order within the deck (geography: nearest to India first)
  suspended     INTEGER NOT NULL DEFAULT 0,  -- 1 = keep in the library, never quiz it
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flashcards_shown ON flashcards (times_shown);
CREATE INDEX IF NOT EXISTS idx_flashcards_deck  ON flashcards (deck, suspended);
CREATE INDEX IF NOT EXISTS idx_flashcards_last  ON flashcards (last_shown_at);
CREATE INDEX IF NOT EXISTS idx_flashcards_hash  ON flashcards (content_hash);
CREATE INDEX IF NOT EXISTS idx_flashcards_due   ON flashcards (due_at);

-- Per-checkpoint attempt log: every card answered, right or wrong. Backs the
-- "missed cards come back until the set is cleared" loop and the stats screen.
CREATE TABLE IF NOT EXISTS flashcard_attempts (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,           -- IST YYYY-MM-DD
  checkpoint INTEGER NOT NULL,        -- which checkpoint of the day (0-based)
  card_id    TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_day  ON flashcard_attempts (day, checkpoint);
CREATE INDEX IF NOT EXISTS idx_attempts_card ON flashcard_attempts (card_id);

CREATE TABLE IF NOT EXISTS flashcard_sources (
  url        TEXT PRIMARY KEY,
  title      TEXT,
  count      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Bank-statement reconciliation.
CREATE TABLE IF NOT EXISTS statements (
  id             TEXT PRIMARY KEY,
  bank           TEXT,
  account_tail   TEXT,
  period_start   TEXT,
  period_end     TEXT,
  parser         TEXT,
  row_count      INTEGER NOT NULL DEFAULT 0,
  credits_ignored INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending | applied
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS statement_items (
  id           TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL,
  kind         TEXT NOT NULL,          -- add | remove | match
  idx          INTEGER,
  date         TEXT,
  description  TEXT,
  merchant     TEXT,
  amount       REAL,
  type         TEXT,
  ref          TEXT,
  txn_id       TEXT,
  dedupe_key   TEXT,
  note         TEXT,
  suggested    TEXT,
  decision     TEXT NOT NULL DEFAULT 'pending',     -- pending | approve | deny | done
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stmt_items_stmt ON statement_items (statement_id);

-- Shared clipboard between the Mac (Dr Watson) and the phone. Text lives here;
-- images/files live in the CLIPBOARD R2 bucket under blob_key. 7-day retention.
CREATE TABLE IF NOT EXISTS clipboard_items (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  device_id   TEXT NOT NULL,
  device_name TEXT,
  kind        TEXT NOT NULL,            -- text | image | file
  text        TEXT,
  blob_key    TEXT,
  mime        TEXT,
  file_name   TEXT,
  byte_size   INTEGER,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_clipboard_owner_created ON clipboard_items (owner, created_at);

-- App usage sessions uploaded by the phone (Android keeps raw events ~1 week).
-- id = '<pkg>:<start_ms>'; a session still open at upload is extended later.
CREATE TABLE IF NOT EXISTS app_sessions (
  id         TEXT PRIMARY KEY,
  pkg        TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  day        TEXT NOT NULL,          -- IST day the session started
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_pkg_start ON app_sessions (pkg, start_ms);
