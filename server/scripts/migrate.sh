#!/usr/bin/env bash
#
# Idempotent D1 migrations for columns that schema.sql can't add to an existing
# table (D1's `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS`). Safe to re-run:
# each ALTER is guarded by a pragma_table_info check, and the backfill is scoped
# to rows that still need it.
#
# Usage:
#   npm run db:migrate           # remote (production D1)
#   npm run db:migrate -- --local # local dev D1
#
set -euo pipefail

TARGET="${1:---remote}"
DB="pft"

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

# --- Columns ---------------------------------------------------------------
add_column_if_missing transactions tags       "tags TEXT"
add_column_if_missing transactions mandate_id "mandate_id TEXT"
add_column_if_missing reports      period_type "period_type TEXT NOT NULL DEFAULT 'weekly'"
add_column_if_missing mandates     emi_total   "emi_total INTEGER"
add_column_if_missing mandates     emi_start   "emi_start TEXT"
add_column_if_missing classification_feedback merchant_norm "merchant_norm TEXT"
add_column_if_missing transactions merchant_norm "merchant_norm TEXT"

exec_sql "CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions (merchant_norm)" >/dev/null
exec_sql "CREATE TABLE IF NOT EXISTS merchant_alias (
            pattern      TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL)" >/dev/null

exec_sql "CREATE INDEX IF NOT EXISTS idx_feedback_merchant ON classification_feedback (merchant_norm)" >/dev/null

# --- Personal-assistant tables (check-ins, chat, habit proofs, statements) ---
# All CREATE ... IF NOT EXISTS, so this is the same idempotent block schema.sql
# carries; pulled in here so an upgrade needs only `npm run db:migrate`.
echo "  ⤳ assistant tables"
ASSIST_SQL="$(mktemp -t pft-assistant).sql"
sed -n '/Personal-assistant features/,$p' ./schema.sql > "$ASSIST_SQL"
npx wrangler d1 execute "$DB" "$TARGET" --file "$ASSIST_SQL" >/dev/null
rm -f "$ASSIST_SQL"

# --- Backfill: migrate the old notes-based mandate link into mandate_id -----
# M2 originally appended `mandate:<id>` to the notes column. The id is a UUID
# with no '|' and was always appended last, so it runs to the end of the string.
echo "  ⤳ backfilling mandate_id from legacy notes"
exec_sql "UPDATE transactions
          SET mandate_id = substr(notes, instr(notes, 'mandate:') + 8)
          WHERE mandate_id IS NULL AND notes LIKE '%mandate:%'" >/dev/null

# Strip the now-redundant mandate marker back out of notes (classifier-only field).
exec_sql "UPDATE transactions
          SET notes = CASE
                        WHEN notes LIKE '%|mandate:%'
                          THEN substr(notes, 1, instr(notes, '|mandate:') - 1)
                        ELSE NULL
                      END
          WHERE notes LIKE '%mandate:%'" >/dev/null

# --- Backfill: occurred_at for manually-logged transactions ----------------
# The add-expense screen left occurredAt undefined when the user did not pick a
# date, so 37 rows stored NULL. Every server query COALESCEs to created_at, so
# the app looked right, but any direct SQL against occurred_at silently dropped
# them. Pin them to their capture time so the column is authoritative.
echo "  ⤳ backfilling occurred_at from created_at"
exec_sql "UPDATE transactions SET occurred_at = created_at, updated_at = created_at
          WHERE occurred_at IS NULL" >/dev/null

# --- Backfill: merchant_norm on existing feedback --------------------------
# Mirrors normalizeMerchant() closely enough for the ASCII merchant names in
# this data (uppercase, strip punctuation, collapse whitespace). The learning
# loop keys on this column, so without it every historical correction is invisible.
echo "  ⤳ backfilling classification_feedback.merchant_norm"
exec_sql "UPDATE classification_feedback
          SET merchant_norm = trim(replace(replace(replace(replace(replace(
                upper(merchant), '.', ' '), ',', ' '), '-', ' '), '/', ' '), '  ', ' '))
          WHERE merchant_norm IS NULL AND merchant IS NOT NULL" >/dev/null

echo "✓ Migration complete"
