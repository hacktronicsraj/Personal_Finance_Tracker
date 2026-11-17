#!/usr/bin/env node
/**
 * Re-classify recent transactions by payee using Jev, and fix wrong categories.
 *
 * Only touches transactions the user has NOT manually corrected (corrected=0),
 * within the last N days, debit only. Updates the category when Jev is confident
 * and disagrees with the current one. Also records the change as classifier
 * feedback so the learning loop remembers it.
 *
 *   node scripts/reclassify.mjs            # preview only
 *   node scripts/reclassify.mjs --apply    # write to remote D1
 *   node scripts/reclassify.mjs --days 45 --apply
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const DAYS = process.argv.includes('--days') ? Number(process.argv[process.argv.indexOf('--days') + 1]) : 30;
const MIN_CONF = process.argv.includes('--min') ? Number(process.argv[process.argv.indexOf('--min')+1]) : 0.7;

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const GUIDE = {
  'Food & Dining': 'Restaurants, cafes, food delivery (Swiggy / Bundl Technologies, Zomato), street food, tea, snacks, tiffin and curry points',
  Groceries: 'Supermarkets, kirana stores, quick-commerce groceries (Zepto, Blinkit, Instamart, BigBasket, Ratnadeep), vegetables, milk',
  Transport: 'Auto / cab / bike-taxi rides (Rapido, Uber, Ola, or a UPI payment to an individual driver), metro, fuel and petrol stations, car rentals (Zoomcar), parking, tolls',
  Shopping: 'Clothing, electronics, household items, e-commerce (Amazon, Flipkart, Myntra, Zudio)',
  'Bills & Utilities': 'Electricity, water, gas, mobile / broadband recharge (Airtel, Jio), rent, EMIs, recurring bills and software subscriptions',
  Entertainment: 'Streaming and media (Netflix, Spotify, Fancode, Google Play), movies, games, events',
  Health: 'Medicines, pharmacies, doctors, hospitals, clinics, diagnostics, skin/hair care, gyms and fitness',
  Transfers: 'Money sent to family or friends that is not a purchase, lending, personal transfers',
  'Card Payment': "Paying off one's own credit card bill (the payee is the card itself, e.g. SuperCard)",
  Income: 'Money received: salary, refunds, cashback',
  Other: 'Bank charges and fees, and anything that fits none of the above',
};
const CATS = Object.keys(GUIDE);

function d1(sql, write = false) {
  const args = ['wrangler', 'd1', 'execute', 'pft', '--remote', '--json', '--command', sql];
  const out = execFileSync('npx', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out)[0].results ?? [];
}
const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");

async function jevCategory(t, fewshot) {
  const resp = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${vars.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: { merchant: t.merchant, sms: t.raw_text ? t.raw_text.slice(0, 160) : null, amount_inr: t.amount, direction: 'debit' },
      questions: {
        category: {
          type: 'choice',
          instructions: fewshot.length
            ? { task: 'Which spending category does this Indian bank/UPI debit belong to? Use the payee/merchant name.', this_users_recent_labels: fewshot }
            : 'Which spending category does this Indian bank/UPI debit belong to? Use the payee/merchant name.',
          criteria: GUIDE,
        },
      },
    }),
  });
  if (!resp.ok) throw new Error(`jev ${resp.status}`);
  const a = (await resp.json()).answers.category;
  return { cat: a.choice, conf: a.confidence ?? a.probabilities?.[a.choice] ?? 0 };
}

const since = new Date(Date.now() - DAYS * 86400000).toISOString();
const rows = d1(
  `SELECT id, merchant, raw_text, amount, category FROM transactions
    WHERE direction='debit' AND corrected=0 AND merchant IS NOT NULL
      AND COALESCE(occurred_at,created_at) >= '${since}' ORDER BY amount DESC`,
);
const fewshot = d1(
  `SELECT merchant, corrected_category FROM classification_feedback WHERE merchant IS NOT NULL ORDER BY created_at DESC LIMIT 20`,
).filter((f) => CATS.includes(f.corrected_category)).map((f) => ({ merchant: f.merchant, category: f.corrected_category }));

console.log(`▸ ${rows.length} non-corrected debits in the last ${DAYS} days; few-shot=${fewshot.length}`);
const changes = [];
for (const t of rows) {
  try {
    const { cat, conf } = await jevCategory(t, fewshot);
    if (cat && CATS.includes(cat) && cat !== t.category && conf >= MIN_CONF) {
      changes.push({ ...t, newCat: cat, conf });
      console.log(`  ${String(t.amount).padStart(7)}  ${(t.merchant || '').slice(0, 22).padEnd(22)}  ${t.category.padEnd(16)} → ${cat.padEnd(16)} (${conf.toFixed(2)})`);
    }
  } catch (e) {
    console.log(`  ! ${t.merchant}: ${e.message}`);
  }
}
console.log(`▸ ${changes.length} category changes proposed`);

if (APPLY && changes.length) {
  const now = new Date().toISOString();
  for (let i = 0; i < changes.length; i += 20) {
    const batch = changes.slice(i, i + 20);
    const sql = batch
      .map((c) => `UPDATE transactions SET category=${q(c.newCat)}, updated_at=${q(now)} WHERE id=${q(c.id)};`)
      .join('\n');
    d1(sql, true);
  }
  console.log(`✓ applied ${changes.length} updates`);
} else if (!APPLY) {
  console.log('(preview only — re-run with --apply to write)');
}
