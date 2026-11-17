#!/usr/bin/env node
/**
 * Head-to-head: Jev (TypeSafe's decision model) vs Gemini on YOUR labelled history.
 *
 * Ground truth = every transaction you corrected/confirmed (corrected = 1) whose
 * category is a built-in one. Each model sees only what exists at classify time
 * (SMS text, parsed merchant, amount, time) — never your note or the answer — plus
 * the same category guide and the same few-shot examples: the 12 corrections made
 * BEFORE that transaction (leave-one-out, like production's recentFeedback()).
 *
 *   node scripts/bench-classify.mjs                # remote D1, Jev + Gemini
 *   node scripts/bench-classify.mjs --jev-only     # skip Gemini (saves free-tier quota)
 *   node scripts/bench-classify.mjs --file rows.json
 *
 * Keys come from .dev.vars (TYPESAFE_API_KEY, LLM_API_KEY/LLM_BASE_URL/LLM_MODEL).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const JEV_ONLY = args.includes('--jev-only');
const FILE = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

// Kept in lockstep with src/categories.ts CATEGORY_GUIDE.
const GUIDE = {
  'Food & Dining': 'Restaurants, cafes, food delivery (Swiggy / Bundl Technologies, Zomato), street food, tea, snacks, tiffin and curry points',
  Groceries: 'Supermarkets, kirana stores, quick-commerce groceries (Zepto, Blinkit, Instamart, BigBasket, Ratnadeep), vegetables, milk',
  Transport: 'Auto / cab / bike-taxi rides (Rapido, Uber, Ola, or a UPI payment to an individual driver), metro, fuel and petrol stations, car rentals (Zoomcar), parking, tolls',
  Shopping: 'Clothing, electronics, household items, e-commerce (Amazon, Flipkart, Myntra, Zudio)',
  'Bills & Utilities': 'Electricity, water, gas, mobile / broadband recharge (Airtel, Jio), rent, EMIs, recurring bills and software subscriptions',
  Entertainment: 'Streaming and media (Netflix, Spotify, Fancode, Google Play), movies, games, events',
  Health: 'Medicines, pharmacies, doctors, hospitals, clinics, diagnostics, skin/hair care, gyms and fitness',
  Transfers: 'Money sent to family or friends that is not a purchase, investments (Groww, SIP, mutual funds), lending',
  'Card Payment': "Paying off one's own credit card bill (the payee is the card itself, e.g. SuperCard)",
  Income: 'Money received: salary, refunds, cashback',
  Other: 'Bank charges and fees, and anything that fits none of the above',
};
const CATS = Object.keys(GUIDE);

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'pft', '--remote', '--json', '--command', sql], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].results ?? [];
}

const all = FILE
  ? JSON.parse(readFileSync(FILE, 'utf8'))[0].results
  : d1('SELECT id, raw_text, amount, direction, merchant, category, source, corrected, occurred_at, created_at FROM transactions ORDER BY created_at');
const labelled = all.filter((r) => r.corrected && CATS.includes(r.category) && r.direction === 'debit');
console.log(`▸ ${labelled.length} labelled debits`);

const stateOf = (r) => ({
  sms: r.raw_text || null,
  merchant: r.merchant || null,
  amount_inr: r.amount,
  direction: r.direction,
  when: r.occurred_at || r.created_at,
});
const fewshotFor = (r) =>
  labelled.filter((x) => x.created_at < r.created_at && x.id !== r.id).slice(-12)
    .map((x) => ({ merchant: x.merchant, sms: x.raw_text ? x.raw_text.slice(0, 160) : null, amount_inr: x.amount, category: x.category }));

async function withRetry(fn, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { err = e; await new Promise((s) => setTimeout(s, 1500 * 2 ** i)); }
  }
  throw err;
}

async function jev(r, fewshot) {
  const t0 = Date.now();
  const res = await withRetry(async () => {
    const resp = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${vars.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: stateOf(r),
        questions: {
          category: {
            type: 'choice',
            instructions: fewshot
              ? { task: 'Which spending category does this Indian bank/UPI debit belong to?', this_users_recent_labels: fewshot }
              : 'Which spending category does this Indian bank/UPI debit belong to?',
            criteria: GUIDE,
          },
        },
      }),
    });
    if (!resp.ok) throw new Error(`jev ${resp.status} ${await resp.text()}`);
    return resp.json();
  });
  const a = res.answers.category;
  return { pred: a.choice, conf: a.confidence ?? a.probabilities?.[a.choice] ?? null, ms: Date.now() - t0 };
}

async function gemini(r, fewshot) {
  const t0 = Date.now();
  const system = [
    'You classify a single Indian bank/UPI debit into exactly one category.',
    'Categories:',
    ...CATS.map((c) => `- ${c}: ${GUIDE[c]}`),
    'Return ONLY minified JSON: {"category":<one category name exactly as listed>,"confidence":<0..1>}.',
  ].join('\n');
  const messages = [{ role: 'system', content: system }];
  for (const ex of fewshot ?? []) {
    messages.push({ role: 'user', content: JSON.stringify({ sms: ex.sms, merchant: ex.merchant, amount_inr: ex.amount_inr }) });
    messages.push({ role: 'assistant', content: JSON.stringify({ category: ex.category, confidence: 0.95 }) });
  }
  messages.push({ role: 'user', content: JSON.stringify(stateOf(r)) });
  const res = await withRetry(async () => {
    const resp = await fetch(`${vars.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${vars.LLM_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: vars.LLM_MODEL, temperature: 0, response_format: { type: 'json_object' }, messages }),
    });
    if (!resp.ok) throw new Error(`gemini ${resp.status} ${(await resp.text()).slice(0, 200)}`);
    return resp.json();
  }, 6);
  const parsed = JSON.parse(res.choices[0].message.content);
  return { pred: parsed.category, conf: parsed.confidence ?? null, ms: Date.now() - t0 };
}

const variants = [
  ['jev-zero', (r) => jev(r, null)],
  ['jev-fewshot', (r) => jev(r, fewshotFor(r))],
  ...(JEV_ONLY ? [] : [['gemini-fewshot', (r) => gemini(r, fewshotFor(r))]]),
];

const results = {};
for (const [name, fn] of variants) {
  const rows = [];
  for (const r of labelled) {
    try {
      const out = await fn(r);
      rows.push({ id: r.id, truth: r.category, merchant: r.merchant, ...out });
    } catch (e) {
      rows.push({ id: r.id, truth: r.category, merchant: r.merchant, pred: null, error: String(e.message).slice(0, 120) });
    }
    // Gemini free tier is ~10 RPM; Jev allows 1,200 RPM.
    if (name.startsWith('gemini')) await new Promise((s) => setTimeout(s, 6500));
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  results[name] = rows;
  const ok = rows.filter((x) => x.pred === x.truth).length;
  const errs = rows.filter((x) => x.error).length;
  const ms = rows.filter((x) => x.ms).map((x) => x.ms).sort((a, b) => a - b);
  console.log(`${name.padEnd(15)} accuracy ${(100 * ok / rows.length).toFixed(1)}%  (${ok}/${rows.length})  errors ${errs}  p50 ${ms[Math.floor(ms.length / 2)]}ms`);
}

// Calibration check for Jev: how accurate is it when it is confident?
for (const name of Object.keys(results).filter((n) => n.startsWith('jev'))) {
  for (const th of [0.6, 0.8, 0.9]) {
    const hi = results[name].filter((x) => (x.conf ?? 0) >= th);
    const ok = hi.filter((x) => x.pred === x.truth).length;
    console.log(`  ${name} conf≥${th}: ${hi.length} rows, ${hi.length ? (100 * ok / hi.length).toFixed(1) : '-'}% correct`);
  }
}

const out = new URL('../.bench-results.json', import.meta.url);
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`▸ per-row results → ${out.pathname}`);
