#!/usr/bin/env node
/**
 * Seed `merchant_rules` from the transaction history that already exists.
 *
 * The runtime learning loop (db.ts:processLearningLoop) only fires on a *new*
 * correction, so every merchant corrected before it worked was never turned into
 * a rule — the table sat empty across 40 corrections. This walks the whole
 * history once and writes the rules that history implies, which is what makes
 * repeat payees (Hyderabad Metro, Zepto, Rapido, the local food stalls) classify
 * correctly on first sight instead of costing an LLM call and a manual fix.
 *
 * Safe to re-run: rules are UPSERTed as 'learned', and upsertRule never
 * overwrites a rule you marked 'manual'.
 *
 *   node scripts/train.mjs            # preview only (no writes)
 *   node scripts/train.mjs --apply    # write to remote D1
 *   node scripts/train.mjs --apply --local
 */
import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');
const TARGET = process.argv.includes('--local') ? '--local' : '--remote';
const DB = 'pft';

/** Vote weights: an explicit user correction outranks the classifier's own guess. */
const W_CORRECTION = 3;
const W_OBSERVED = 1;

function d1(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB, TARGET, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return JSON.parse(out)[0].results ?? [];
}

/** Must mirror normalizeMerchant() in src/classify.ts — rules are keyed on it. */
function normalizeMerchant(merchant) {
  let m = (merchant || '').toUpperCase();
  m = m.replace(/@[A-Z0-9.\-]+/g, '');
  m = m.replace(/\*.*$/g, '');
  m = m.replace(/\s*-\s*(ORDER|REF|TXN|ID)?\s*[0-9]+.*$/g, '');
  m = m.replace(/[^A-Z0-9 ]/g, ' ');
  return m.replace(/\s+/g, ' ').trim();
}

/**
 * Payees that are one of your own cards. History labels these Bills & Utilities
 * (that is what they were before 'Card Payment' existed), and a merchant rule is
 * consulted *before* the classifier — so training on the historical label would
 * reinstate the double-count the card-settlement rule exists to stop.
 * Must mirror CARD_PAYEE_RE in src/classify.ts.
 */
const CARD_PAYEE_RE = /\b(?:super\s?ca(?:rd)?|credit\s?card|onecard|one\s?card|slice\s?card|uni\s?card|cred)\b/i;

/** Must mirror isLearnableMerchant() in src/db.ts. */
const UNLEARNABLE_RE =
  /^(?:\?|unknown|n\/?a|upi(?: transfer| payment)?|super\s?ca(?:rd)? payment|card payment|payment|dispute call\b.*|to (?:block|dispute)\b.*)$/i;
function isLearnable(merchant) {
  const m = (merchant ?? '').trim();
  if (m.length < 3) return false;
  if (UNLEARNABLE_RE.test(m)) return false;
  return /[A-Za-z]{3}/.test(m);
}

const txns = d1(
  `SELECT merchant, category, corrected FROM transactions
   WHERE merchant IS NOT NULL AND direction = 'debit'`,
);
const feedback = d1(
  `SELECT merchant, corrected_category FROM classification_feedback
   WHERE merchant IS NOT NULL AND corrected_category IS NOT NULL`,
);

// merchant_norm -> { display, votes: Map<category, weight>, corrections, seen }
const agg = new Map();
function vote(merchant, category, weight, isCorrection) {
  if (!category || !isLearnable(merchant)) return;
  const norm = normalizeMerchant(merchant);
  if (!norm) return;
  let e = agg.get(norm);
  if (!e) agg.set(norm, (e = { display: merchant.trim(), votes: new Map(), corrections: 0, seen: 0 }));
  e.votes.set(category, (e.votes.get(category) ?? 0) + weight);
  e.seen += 1;
  if (isCorrection) e.corrections += 1;
}

for (const t of txns) vote(t.merchant, t.category, t.corrected ? W_CORRECTION : W_OBSERVED, !!t.corrected);
for (const f of feedback) vote(f.merchant, f.corrected_category, W_CORRECTION, true);

const rules = [];
const skipped = [];
for (const [norm, e] of agg) {
  const ranked = [...e.votes.entries()].sort((a, b) => b[1] - a[1]);
  const [winner, wv] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  // A tie means the merchant genuinely spans categories — leave it to the LLM.
  if (wv === runnerUp) {
    skipped.push([norm, `ambiguous (${ranked.map(([c, v]) => `${c}:${v}`).join(', ')})`]);
    continue;
  }
  // Trust either an explicit correction, or a merchant seen repeatedly with one label.
  const trusted = e.corrections > 0 || e.seen >= 2;
  if (!trusted) {
    skipped.push([norm, 'single unconfirmed sighting']);
    continue;
  }
  // Overridden, not learned — see CARD_PAYEE_RE above.
  const category = CARD_PAYEE_RE.test(norm) ? 'Card Payment' : winner;
  rules.push({ norm, category, display: e.display, seen: e.seen, corrections: e.corrections, margin: wv - runnerUp });
}

rules.sort((a, b) => b.seen - a.seen || a.norm.localeCompare(b.norm));

console.log(`transactions: ${txns.length}   feedback: ${feedback.length}   merchants: ${agg.size}`);
console.log(`\n▸ ${rules.length} rules to write\n`);
for (const r of rules) {
  console.log(
    `  ${r.norm.padEnd(26)} → ${r.category.padEnd(18)} (seen ${String(r.seen).padStart(2)}, corrections ${r.corrections})`,
  );
}
if (skipped.length) {
  console.log(`\n▸ ${skipped.length} skipped`);
  for (const [n, why] of skipped) console.log(`  ${n.padEnd(26)} — ${why}`);
}

if (!APPLY) {
  console.log('\n(preview only — re-run with --apply to write)');
  process.exit(0);
}

const now = new Date().toISOString();
const esc = (s) => String(s).replace(/'/g, "''");
// Chunked so a long history stays under D1's per-statement limits.
for (let i = 0; i < rules.length; i += 25) {
  const chunk = rules.slice(i, i + 25);
  const values = chunk
    .map(
      (r) =>
        `(lower(hex(randomblob(16))), '${esc(r.norm)}', '${esc(r.category)}', 'learned', ${r.seen}, '${now}', '${now}')`,
    )
    .join(',\n    ');
  // Never clobber a rule the user pinned as 'manual'.
  d1(
    `INSERT INTO merchant_rules (id, pattern, category, source, hit_count, created_at, updated_at)
     VALUES ${values}
     ON CONFLICT(pattern) DO UPDATE SET
       category   = CASE WHEN merchant_rules.source = 'manual' THEN merchant_rules.category ELSE excluded.category END,
       updated_at = CASE WHEN merchant_rules.source = 'manual' THEN merchant_rules.updated_at ELSE excluded.updated_at END`,
  );
  console.log(`  wrote ${Math.min(i + 25, rules.length)}/${rules.length}`);
}
console.log('\n✓ rules written');
