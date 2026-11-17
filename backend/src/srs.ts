/**
 * Which cards a gate checkpoint shows — the "when do I see this again" half of
 * spaced repetition (the scheduling half is reviewCard() in assistantDb.ts).
 *
 * Pure, so it is unit-tested without D1. The deck is a few hundred cards, so
 * the caller loads every active card and this picks from memory.
 *
 * Order, following how Anki/SuperMemo run a session:
 *  1. Due reviews — cards already learned whose due time has passed, most
 *     overdue first. Reviewing on time is what retention depends on, so these
 *     always come before anything new. Short relearning steps (a card missed
 *     minutes ago) land here too.
 *  2. New cards, at most NEW_PER_DAY a day (IST). Capping new cards keeps the
 *     review load of later days bounded — 20 new a day settles at roughly
 *     100–150 reviews a day, spread across checkpoints. Within a deck, cards
 *     with a `new_order` come in that order (geography: nearest to India
 *     first, spreading outward), the rest at random. Decks take turns, so a
 *     big deck can't starve a small one; the catch-all 'default' deck goes last.
 *  3. Fill — if the checkpoint still has room, cards that aren't due yet,
 *     least-recently-seen first, skipping ones seen in the last REST_HOURS.
 *     recordQuizResults() doesn't let these early looks move the schedule.
 *  4. Overflow new cards beyond the daily cap, before ever repeating a card
 *     seen moments ago.
 *  5. Anything left, so a tiny deck still fills the set.
 *
 * Siblings: cards sharing a `grp` (e.g. France's capital, flag and location)
 * never appear in the same checkpoint, since one would give away another, and
 * a NEW card is held back while a sibling was seen in the last
 * SIBLING_BURY_HOURS — siblings get introduced on different days.
 */

export const NEW_PER_DAY = 20;
export const REST_HOURS = 2;
export const SIBLING_BURY_HOURS = 20;

export interface SrsCard {
  id: string;
  deck: string;
  grp: string | null;
  reps: number;
  due_at: string | null;
  last_shown_at: string | null;
  introduced_at: string | null;
  times_shown: number;
  /** Introduction order for new cards within their deck; null = random. */
  new_order?: number | null;
}

const ms = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

/** A card is "new" until it has been graded once. */
export const isNew = (c: SrsCard) => c.introduced_at == null && c.times_shown === 0 && c.due_at == null;

export function selectQuiz<T extends SrsCard>(
  cards: T[],
  n: number,
  opts: { nowMs: number; introducedToday: number; random?: () => number; newPerDay?: number },
): T[] {
  const { nowMs } = opts;
  const rnd = opts.random ?? Math.random;
  const newPerDay = opts.newPerDay ?? NEW_PER_DAY;

  // Siblings seen recently, by group.
  const buryCutoff = nowMs - SIBLING_BURY_HOURS * 3600_000;
  const recentByGrp = new Map<string, Set<string>>();
  for (const c of cards) {
    const seen = ms(c.last_shown_at);
    if (c.grp && seen != null && seen > buryCutoff) {
      if (!recentByGrp.has(c.grp)) recentByGrp.set(c.grp, new Set());
      recentByGrp.get(c.grp)!.add(c.id);
    }
  }
  const siblingSeenRecently = (c: T) => {
    const s = c.grp ? recentByGrp.get(c.grp) : undefined;
    return !!s && [...s].some((id) => id !== c.id);
  };

  // Shuffle once so every tie below breaks randomly but stably within this call.
  const shuffled = cards.map((c) => ({ c, r: rnd() }));
  shuffled.sort((a, b) => a.r - b.r);
  const pool = shuffled.map((x) => x.c);

  const fresh = pool.filter(isNew);
  const learned = pool.filter((c) => !isNew(c));

  const due = learned
    .filter((c) => (ms(c.due_at) ?? 0) <= nowMs)
    .sort((a, b) => (ms(a.due_at) ?? 0) - (ms(b.due_at) ?? 0));

  const newOrdered = interleaveDecks(fresh.filter((c) => !siblingSeenRecently(c)));
  const newQuota = Math.max(0, newPerDay - opts.introducedToday);

  const restCutoff = nowMs - REST_HOURS * 3600_000;
  const early = learned
    .filter((c) => (ms(c.due_at) ?? 0) > nowMs && (ms(c.last_shown_at) ?? 0) < restCutoff)
    .sort((a, b) => (ms(a.last_shown_at) ?? 0) - (ms(b.last_shown_at) ?? 0));

  const picked: T[] = [];
  const pickedIds = new Set<string>();
  const pickedGrps = new Set<string>();
  const take = (list: T[], limit = Infinity) => {
    let added = 0;
    for (const c of list) {
      if (picked.length >= n || added >= limit) return;
      if (pickedIds.has(c.id)) continue;
      if (c.grp && pickedGrps.has(c.grp)) continue;
      picked.push(c);
      pickedIds.add(c.id);
      if (c.grp) pickedGrps.add(c.grp);
      added++;
    }
  };

  take(due);
  take(newOrdered, newQuota);
  take(early);
  take(newOrdered);
  take(pool);

  // Interleave reviews and new cards rather than serving them in tiers.
  return picked
    .map((c) => ({ c, r: rnd() }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.c);
}

/**
 * New cards in introduction order: each deck sorted by new_order (cards
 * without one keep the shuffled order, after the ordered ones), then the decks
 * dealt round-robin with 'default' last.
 */
function interleaveDecks<T extends SrsCard>(cards: T[]): T[] {
  const byDeck = new Map<string, T[]>();
  for (const c of cards) {
    if (!byDeck.has(c.deck)) byDeck.set(c.deck, []);
    byDeck.get(c.deck)!.push(c);
  }
  const rank = (c: T) => (c.new_order == null ? Number.POSITIVE_INFINITY : c.new_order);
  const decks = [...byDeck.entries()]
    .sort(([a], [b]) => (a === 'default' ? 1 : 0) - (b === 'default' ? 1 : 0))
    .map(([, list]) => list.sort((a, b) => rank(a) - rank(b)));
  const out: T[] = [];
  for (let i = 0; decks.some((d) => i < d.length); i++) {
    for (const d of decks) if (i < d.length) out.push(d[i]);
  }
  return out;
}
