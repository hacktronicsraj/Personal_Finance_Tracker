#!/usr/bin/env node
/**
 * Backfill flashcards.content_hash for rows imported before the column existed.
 *
 * Bulk-import dedupe compares content_hash, so unhashed legacy rows would never
 * match an incoming card. Safe to re-run: it only touches rows where
 * content_hash IS NULL.
 *
 * Runs as ONE wrangler invocation (a .sql file) rather than one per row — the
 * wrangler CLI takes ~1-2s to start, so per-row updates would crawl.
 *
 * Usage:
 *   node scripts/backfill-hashes.mjs            # remote (production D1)
 *   node scripts/backfill-hashes.mjs --local    # local dev D1
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv.includes('--local') ? '--local' : '--remote';
const DB = 'pft-native';

/** FNV-1a 32-bit — must match hashCard() in src/assistantDb.ts. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** SQL string literal — double single quotes. */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function d1(args) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, TARGET, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

console.log(`▸ Backfilling content_hash (${DB} ${TARGET})`);

const out = d1(['--json', '--command', 'SELECT id, question, options FROM flashcards WHERE content_hash IS NULL']);
// wrangler --json returns [{results:[...], success, meta}] across versions.
let rows = [];
try {
  const parsed = JSON.parse(out);
  rows = Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed?.results ?? []);
} catch {
  console.error('  ! could not parse wrangler output');
  process.exit(1);
}

if (!rows.length) {
  console.log('  · nothing to backfill');
  process.exit(0);
}

const sql = rows
  .map((r) => `UPDATE flashcards SET content_hash = ${q(fnv1a(`${r.question}\u0000${r.options}`))} WHERE id = ${q(r.id)};`)
  .join('\n');

const dir = mkdtempSync(join(tmpdir(), 'pft-hash-'));
const file = join(dir, 'backfill.sql');
writeFileSync(file, sql);

d1(['--file', file]);
console.log(`✓ hashed ${rows.length} card(s)`);
