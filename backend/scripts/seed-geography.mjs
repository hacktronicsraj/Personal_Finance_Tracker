#!/usr/bin/env node
/**
 * Seed the "geography" flashcard deck: for each of 195 countries, three cards —
 * its capital, its flag, and the country shown in red on a world map. 585 cards.
 *
 * Proximity drives both the order and the options:
 *  • new_order: countries are introduced nearest-to-India first, spreading
 *    outward (srs.ts introduces new cards in new_order).
 *  • Distractors on every card are the 3 nearest countries, so the options are
 *    real neighbours rather than giveaways. The three cards of one country
 * share grp 'geo:<ISO2>', so the quiz never shows them together and introduces
 * them on different days (see srs.ts).
 *
 * Idempotent: ids are fixed ('geo-FR-capital', …) and rows are upserted, so a
 * re-run never duplicates. Progress is kept unless a card's question changed.
 * Options are shuffled with a seeded RNG, so a re-run produces identical rows.
 *
 * Usage:
 *   node scripts/seed-geography.mjs            # remote (production D1)
 *   node scripts/seed-geography.mjs --local    # local dev D1
 *   node scripts/seed-geography.mjs --dry      # print a sample, write nothing
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COUNTRIES, REGIONS, CAPITAL_NOTES } from './geography-data.mjs';

/** Country label points [lon, lat] from Natural Earth (public domain). */
const CENTROIDS = JSON.parse(readFileSync(new URL('./geography-centroids.json', import.meta.url), 'utf8'));
const HOME = 'IN';

const TARGET = process.argv.includes('--local') ? '--local' : '--remote';
const DRY = process.argv.includes('--dry');
const DB = 'pft-native';
const DECK = 'geography';
const SOURCE = 'seed:geography';

/** FNV-1a 32-bit — must match hashCard() in src/assistantDb.ts. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Seeded PRNG (mulberry32) so re-runs are byte-identical. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffle = (arr, r) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const flag = (iso) => String.fromCodePoint(...[...iso.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

const countries = COUNTRIES.map(([name, iso, capital, region]) => ({ name, iso, capital, region }));
for (const c of countries) if (!REGIONS[c.region]) throw new Error(`bad region ${c.region} for ${c.name}`);
if (new Set(countries.map((c) => c.iso)).size !== countries.length) throw new Error('duplicate ISO code');

/** Great-circle distance in km between two countries' label points. */
function km(a, b) {
  const [lon1, lat1] = CENTROIDS[a].map((v) => (v * Math.PI) / 180);
  const [lon2, lat2] = CENTROIDS[b].map((v) => (v * Math.PI) / 180);
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The 3 countries nearest `c` — the map card's distractors, so the guess
 *  has to tell neighbours apart. */
function nearest(c) {
  return countries
    .filter((o) => o.iso !== c.iso)
    .sort((a, b) => km(c.iso, a.iso) - km(c.iso, b.iso))
    .slice(0, 3);
}

/** Correct answer + distractors, shuffled → { options, answer }. */
function mcq(correct, wrong, r) {
  const options = shuffle([correct, ...wrong], r);
  return { options, answer: options.indexOf(correct) };
}

for (const c of countries) if (!CENTROIDS[c.iso]) throw new Error(`no centroid for ${c.iso}`);

// New cards are introduced nearest-to-India first, spreading outward.
const byDistance = [...countries].sort((a, b) => km(HOME, a.iso) - km(HOME, b.iso));
const rank = new Map(byDistance.map((c, i) => [c.iso, i]));

const cards = [];
for (const c of countries) {
  const order = rank.get(c.iso) * 3;
  const r = rng(parseInt(fnv1a(c.iso), 16));
  const grp = `geo:${c.iso}`;
  const near = nearest(c);

  const cap = mcq(c.capital, near.map((o) => o.capital), r);
  cards.push({
    id: `geo-${c.iso}-capital`,
    question: CAPITAL_NOTES[c.iso] ?? `What is the capital of ${c.name}?`,
    ...cap,
    grp,
    order: order + 1,
  });

  const fl = mcq(c.name, near.map((o) => o.name), r);
  cards.push({ id: `geo-${c.iso}-flag`, question: `Which country's flag is this?\n${flag(c.iso)}`, ...fl, grp, order: order + 2 });

  // Map card: the country in red on a world map, drawn by the app from its
  // bundled Natural Earth outlines.
  const map = mcq(c.name, near.map((o) => o.name), r);
  cards.push({ id: `geo-${c.iso}-where`, question: `Which country is shown in red?\n[map:${c.iso}]`, ...map, grp, order });
}

for (const card of cards) {
  if (card.options.length !== 4 || new Set(card.options).size !== 4) throw new Error(`bad options for ${card.id}`);
}

console.log(`▸ ${cards.length} geography cards (${countries.length} countries)`);

if (DRY) {
  for (const id of ['geo-FR-capital', 'geo-FR-flag', 'geo-FR-where', 'geo-BO-capital', 'geo-TV-where']) {
    console.log(JSON.stringify(cards.find((c) => c.id === id)));
  }
  console.log('first 20 countries:', byDistance.slice(0, 20).map((c) => c.name).join(', '));
  console.log('last 5:', byDistance.slice(-5).map((c) => c.name).join(', '));
  process.exit(0);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const created = new Date().toISOString();
// Upsert: new rows go in; existing rows get the latest wording and order. A
// card whose question changed is a new question, so its schedule restarts;
// every other card keeps its progress.
const sql = cards
  .map((c) => {
    const opts = JSON.stringify(c.options);
    const hash = fnv1a(`${c.question}\u0000${opts}`);
    const reset = (col, fresh) => `${col} = CASE WHEN flashcards.question <> excluded.question THEN ${fresh} ELSE flashcards.${col} END`;
    return (
      'INSERT INTO flashcards (id, question, options, answer, difficulty, deck, source_url, content_hash, grp, new_order, times_shown, times_correct, created_at) VALUES (' +
      [q(c.id), q(c.question), q(opts), c.answer, q('medium'), q(DECK), q(SOURCE), q(hash), q(c.grp), c.order, 0, 0, q(created)].join(', ') +
      ') ON CONFLICT(id) DO UPDATE SET ' +
      [
        reset('times_shown', 0), reset('times_correct', 0), reset('ease', 2.5), reset('interval_days', 0),
        reset('reps', 0), reset('due_at', 'NULL'), reset('last_shown_at', 'NULL'), reset('introduced_at', 'NULL'),
        'question = excluded.question', 'options = excluded.options', 'answer = excluded.answer',
        'content_hash = excluded.content_hash', 'grp = excluded.grp', 'new_order = excluded.new_order',
      ].join(', ') +
      ';'
    );
  })
  .join('\n');

const dir = mkdtempSync(join(tmpdir(), 'pft-geo-'));
const file = join(dir, 'geography.sql');
writeFileSync(file, sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', DB, TARGET, '--file', file], { stdio: 'inherit' });
console.log('✓ seeded');
