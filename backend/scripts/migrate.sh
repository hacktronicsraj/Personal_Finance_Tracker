#!/usr/bin/env bash
#
# Idempotent D1 migrations for columns that schema.sql can't add to an existing
# table (D1's `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS`). Safe to re-run:
# each ALTER is guarded by a pragma_table_info check.
#
# Usage:
#   npm run db:migrate              # remote (production D1)
#   npm run db:migrate -- --local   # local dev D1
#
set -euo pipefail

TARGET="${1:---remote}"
DB="pft-native"

echo "▸ Migrating $DB ($TARGET)"

exec_sql() {
  npx wrangler d1 execute "$DB" "$TARGET" --command "$1"
}

# Add a column only if pragma_table_info doesn't already list it.
add_column_if_missing() {
  local table="$1" col="$2" decl="$3"
  if npx wrangler d1 execute "$DB" "$TARGET" --json \
       --command "SELECT name FROM pragma_table_info('$table')" 2>/dev/null \
       | grep -q "\"$col\""; then
    echo "  · $table.$col present — skip"
  else
    echo "  + $table.$col"
    exec_sql "ALTER TABLE $table ADD COLUMN $decl" >/dev/null
  fi
}

# --- Flashcards: decks, spacing, dedupe, suspend ---------------------------
add_column_if_missing flashcards deck          "deck TEXT NOT NULL DEFAULT 'default'"
add_column_if_missing flashcards content_hash  "content_hash TEXT"
add_column_if_missing flashcards last_shown_at "last_shown_at TEXT"
add_column_if_missing flashcards suspended     "suspended INTEGER NOT NULL DEFAULT 0"

# --- Flashcards: spaced repetition (SM-2) ----------------------------------
add_column_if_missing flashcards ease          "ease REAL NOT NULL DEFAULT 2.5"
add_column_if_missing flashcards interval_days "interval_days REAL NOT NULL DEFAULT 0"
add_column_if_missing flashcards reps          "reps INTEGER NOT NULL DEFAULT 0"
add_column_if_missing flashcards due_at        "due_at TEXT"

exec_sql "CREATE INDEX IF NOT EXISTS idx_flashcards_deck ON flashcards (deck, suspended)" >/dev/null
exec_sql "CREATE INDEX IF NOT EXISTS idx_flashcards_last ON flashcards (last_shown_at)" >/dev/null
exec_sql "CREATE INDEX IF NOT EXISTS idx_flashcards_hash ON flashcards (content_hash)" >/dev/null
exec_sql "CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards (due_at)" >/dev/null

# --- New tables ------------------------------------------------------------
# CREATE ... IF NOT EXISTS, so re-running is safe.
echo "  ⤳ flashcard_attempts"
exec_sql "CREATE TABLE IF NOT EXISTS flashcard_attempts (
            id         TEXT PRIMARY KEY,
            day        TEXT NOT NULL,
            checkpoint INTEGER NOT NULL,
            card_id    TEXT NOT NULL,
            correct    INTEGER NOT NULL,
            created_at TEXT NOT NULL)" >/dev/null
exec_sql "CREATE INDEX IF NOT EXISTS idx_attempts_day ON flashcard_attempts (day, checkpoint)" >/dev/null
exec_sql "CREATE INDEX IF NOT EXISTS idx_attempts_card ON flashcard_attempts (card_id)" >/dev/null

# --- Backfill --------------------------------------------------------------
# content_hash can't be computed in SQL (D1 has no hash fn), so legacy rows keep
# NULL until scripts/backfill-hashes.mjs runs. NULL is treated as "unhashed",
# not "unique", so the dedupe simply skips them until backfilled.
echo "  ⤳ backfill content_hash"
node ./scripts/backfill-hashes.mjs $([ "$TARGET" = "--local" ] && echo "--local")

echo "✓ done"
