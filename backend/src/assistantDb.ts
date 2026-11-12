import { uid } from './db';
import type { Flashcard } from './flashcards';
import type { Env } from './types';

export interface FlashcardRow {
  id: string;
  question: string;
  options: string; // JSON array
  answer: number;
  difficulty: string;
  deck: string;
  source_url: string | null;
  content_hash: string | null;
  times_shown: number;
  times_correct: number;
  last_shown_at: string | null;
  ease: number;
  interval_days: number;
  reps: number;
  due_at: string | null;
  suspended: number;
  created_at: string;
}

const nowIso = () => new Date().toISOString();

/**
 * FNV-1a 32-bit over question+options — the bulk-import dedupe key. Deliberately
 * simple (no crypto import): this is a duplicate guard, not a security boundary.
 * Must stay in sync with scripts/backfill-hashes.mjs.
 */
export function hashCard(question: string, options: string[] | string): string {
  const opts = typeof options === 'string' ? options : JSON.stringify(options);
  const input = `${question}\u0000${opts}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export async function alreadyImported(env: Env, url: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT url FROM flashcard_sources WHERE url = ?').bind(url).first();
  return !!row;
}

export async function insertFlashcards(
  env: Env,
  cards: Flashcard[],
  sourceUrl: string,
  title: string | null,
  deck = 'default',
): Promise<number> {
  if (!cards.length) return 0;
  const ts = nowIso();
  const stmts = cards.map((c) =>
    env.DB.prepare(
      `INSERT INTO flashcards (id, question, options, answer, difficulty, deck, source_url, content_hash, times_shown, times_correct, created_at)
       VALUES (?,?,?,?,?,?,?,?,0,0,?)`,
    ).bind(
      uid(),
      c.question,
      JSON.stringify(c.options),
      c.answer,
      c.difficulty,
      deck,
      sourceUrl,
      hashCard(c.question, c.options),
      ts,
    ),
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO flashcard_sources (url, title, count, created_at) VALUES (?,?,?,?)
       ON CONFLICT(url) DO UPDATE SET count = count + excluded.count`,
    ).bind(sourceUrl, title, cards.length, ts),
  );
  await env.DB.batch(stmts);
  return cards.length;
}

export async function countFlashcards(env: Env, deck?: string | null): Promise<number> {
  const row = deck
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE deck = ? AND suspended = 0').bind(deck).first<{ n: number }>()
    : await env.DB.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE suspended = 0').first<{ n: number }>();
  return row?.n ?? 0;
}

export interface BulkInsertResult {
  added: number;
  skipped: number; // duplicate of an existing card (any deck)
  deck: string;
}

/**
 * Insert bulk-imported cards, skipping duplicates.
 *
 * Dedupe is by content_hash across the WHOLE library, not per deck — the same
 * question in two decks would otherwise be graded twice for one checkpoint,
 * which is exactly the repetition the spacing rule exists to prevent.
 *
 * Rows with a NULL content_hash (pre-P1 legacy) are ignored by the comparison
 * rather than treated as unique, so they never block a real import.
 */
export async function insertFlashcardsBulk(
  env: Env,
  cards: Flashcard[],
  deck: string,
  sourceLabel: string,
): Promise<BulkInsertResult> {
  if (!cards.length) return { added: 0, skipped: 0, deck };

  const hashes = cards.map((c) => hashCard(c.question, c.options));
  const existing = new Set<string>();
  // D1 caps bound parameters; chunk the IN() lookup.
  for (let i = 0; i < hashes.length; i += 50) {
    const chunk = hashes.slice(i, i + 50);
    const { results } = await env.DB.prepare(
      `SELECT content_hash FROM flashcards WHERE content_hash IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<{ content_hash: string }>();
    for (const r of results ?? []) existing.add(r.content_hash);
  }

  const ts = nowIso();
  const seenInBatch = new Set<string>();
  const stmts = [];
  let added = 0;
  let skipped = 0;

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const hash = hashes[i];
    if (existing.has(hash) || seenInBatch.has(hash)) {
      skipped++;
      continue;
    }
    seenInBatch.add(hash);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO flashcards (id, question, options, answer, difficulty, deck, source_url, content_hash, times_shown, times_correct, created_at)
         VALUES (?,?,?,?,?,?,?,?,0,0,?)`,
      ).bind(uid(), c.question, JSON.stringify(c.options), c.answer, c.difficulty, deck, sourceLabel, hash, ts),
    );
    added++;
  }

  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return { added, skipped, deck };
}

/** Distinct decks with their live card counts — powers the library screen. */
export async function listDecks(env: Env): Promise<{ deck: string; count: number }[]> {
  const res = await env.DB.prepare(
    'SELECT deck, COUNT(*) AS count FROM flashcards WHERE suspended = 0 GROUP BY deck ORDER BY deck',
  ).all<{ deck: string; count: number }>();
  return res.results ?? [];
}

/**
 * N cards for a quiz, spaced-repetition aware.
 *
 * Selection order:
 *  1. Deck priority — cards from any deck OTHER than 'default' come first, so
 *     a subject you're actively studying outranks the catch-all deck. Default
 *     cards only surface once the priority decks are exhausted.
 *  2. Due first — cards whose due_at has passed (or is unset) before cards not
 *     yet due.
 *  3. Least recently shown, then random, to break ties without repeating.
 *
 * A deck small enough to run out of due cards still fills the quiz by falling
 * through to cards that aren't due yet — better to show a card early than to
 * hand the gate an empty set.
 */
export const SPACING_HOURS = 24;

export async function pickQuiz(
  env: Env,
  n: number,
  opts: { deck?: string | null; spacingHours?: number; exclude?: string[] } = {},
): Promise<FlashcardRow[]> {
  const hours = opts.spacingHours ?? SPACING_HOURS;
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  const nowIsoStr = new Date().toISOString();
  const where: string[] = ['suspended = 0'];
  const binds: unknown[] = [];
  if (opts.deck) {
    where.push('deck = ?');
    binds.push(opts.deck);
  }
  if (opts.exclude?.length) {
    where.push(`id NOT IN (${opts.exclude.map(() => '?').join(',')})`);
    binds.push(...opts.exclude);
  }
  const sql = `SELECT * FROM flashcards
               WHERE ${where.join(' AND ')}
               ORDER BY
                 CASE WHEN deck = 'default' THEN 1 ELSE 0 END,
                 CASE WHEN due_at IS NULL OR due_at <= ? THEN 0 ELSE 1 END,
                 CASE WHEN last_shown_at IS NULL OR last_shown_at < ? THEN 0 ELSE 1 END,
                 COALESCE(due_at, '') ASC,
                 times_shown ASC,
                 RANDOM()
               LIMIT ?`;
  const res = await env.DB.prepare(sql)
    .bind(...binds, nowIsoStr, cutoff, Math.max(1, n))
    .all<FlashcardRow>();
  return res.results ?? [];
}

export async function getFlashcards(env: Env, ids: string[]): Promise<FlashcardRow[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const res = await env.DB.prepare(`SELECT * FROM flashcards WHERE id IN (${placeholders})`).bind(...ids).all<FlashcardRow>();
  return res.results ?? [];
}

/**
 * SM-2 spaced repetition (SuperMemo 2, Wozniak 1987) — the algorithm Anki grew
 * out of. Chosen over FSRS because it needs no training data and only three
 * numbers per card.
 *
 * Grade mapping: correct → quality 5 ("perfect response"), wrong → 2
 * ("incorrect, but the answer felt familiar"). A 4-option MCQ doesn't tell us
 * how confidently you answered, so a single correct/wrong bit maps to the
 * standard end points rather than inventing precision we don't have.
 * Note quality 4 would leave ease unchanged (+0.0) — 5 is what lets a card
 * you keep getting right drift further out.
 *
 * The schedule:
 *  • rep 1 → 1 day, rep 2 → 6 days, then interval × ease (SM-2's fixed steps).
 *  • A wrong answer resets reps to 0 and drops the interval back to 1 day, so a
 *    card you keep missing returns next session instead of vanishing.
 *  • Ease adjusts by quality: correct nudges it up, wrong pulls it down, floor 1.3.
 *
 * This is what makes "repeat at the best time" real: each card has its own
 * growing interval, so well-known cards fade out and shaky ones come back fast.
 */
export interface ReviewOutcome {
  ease: number;
  interval_days: number;
  reps: number;
  due_at: string;
}

export function reviewCard(
  card: { ease: number; interval_days: number; reps: number },
  correct: boolean,
  nowMs = Date.now(),
): ReviewOutcome {
  const quality = correct ? 5 : 2;
  const ease = Math.max(1.3, card.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  let reps = card.reps;
  let interval: number;
  if (!correct) {
    reps = 0;
    interval = 1;
  } else {
    reps = card.reps + 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(card.interval_days * ease);
  }

  const dueAt = new Date(nowMs + interval * 86_400_000).toISOString();
  return { ease: Number(ease.toFixed(3)), interval_days: interval, reps, due_at: dueAt };
}

export async function recordQuizResults(
  env: Env,
  results: { id: string; correct: boolean }[],
  day: string | null = null,
  checkpoint: number | null = null,
): Promise<void> {
  if (!results.length) return;
  const ts = nowIso();
  const nowMs = Date.now();

  // SM-2 needs each card's current schedule, so read them first.
  const rows = await getFlashcards(env, results.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const stmts = results.map((r) => {
    const card = byId.get(r.id);
    const next = reviewCard(
      {
        ease: card?.ease ?? 2.5,
        interval_days: card?.interval_days ?? 0,
        reps: card?.reps ?? 0,
      },
      r.correct,
      nowMs,
    );
    return env.DB.prepare(
      `UPDATE flashcards
          SET times_shown = times_shown + 1,
              times_correct = times_correct + ?,
              last_shown_at = ?,
              ease = ?, interval_days = ?, reps = ?, due_at = ?
        WHERE id = ?`,
    ).bind(
      r.correct ? 1 : 0,
      ts,
      next.ease,
      next.interval_days,
      next.reps,
      next.due_at,
      r.id,
    );
  });

  // Attempt log: only written when the caller knows which checkpoint this is,
  // so ad-hoc quizzes don't pollute the daily stats.
  if (day && checkpoint != null) {
    for (const r of results) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO flashcard_attempts (id, day, checkpoint, card_id, correct, created_at) VALUES (?,?,?,?,?,?)',
        ).bind(uid(), day, checkpoint, r.id, r.correct ? 1 : 0, ts),
      );
    }
  }
  await env.DB.batch(stmts);
}
