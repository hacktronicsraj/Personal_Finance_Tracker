import type { Env } from './types';

/**
 * Jev — TypeSafe AI's "System One" decision model. Instead of generating text it
 * returns a typed decision with calibrated probabilities:
 *   choice → one option from a map you supply (≤255)
 *   noul   → probability that a yes/no statement is true
 *   score  → a position on an ordered rubric (2–10 levels)
 * It can't invent a category or break a JSON schema, and answers in ~100–400ms,
 * which makes it the right tool for the classify-this / is-this-valid calls.
 * It is text-only — anything visual (receipts, the blanket photo) stays on the
 * multimodal LLM.
 *
 * API: POST https://api.typesafe.ai/v1/systemone  { model, state, questions }
 */

export type JevQuestion =
  | { type: 'choice'; instructions: unknown; criteria: Record<string, string | null> }
  | { type: 'noul'; instructions: unknown; criteria?: { true: string; false: string } }
  | { type: 'score'; instructions: unknown; criteria: string[] };

export interface JevAnswer {
  type: 'choice' | 'noul' | 'score';
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export function jevEnabled(env: Env): boolean {
  return !!env.TYPESAFE_API_KEY && env.LLM_MODE !== 'mock';
}

/**
 * Ask Jev one or more typed questions about `state`. Transient failures (429,
 * 529 overloaded, 5xx, timeouts) are retried with backoff — 1 try + `retries`
 * retries. Throws when every attempt fails so callers can fall back.
 */
export async function jevDecide(
  env: Env,
  state: unknown,
  questions: Record<string, JevQuestion>,
  opts: { retries?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Record<string, JevAnswer>> {
  if (!env.TYPESAFE_API_KEY) throw new Error('jev not configured');
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const doFetch = opts.fetchImpl ?? fetch;
  const body = JSON.stringify({ model: env.JEV_MODEL ?? 'jev-latest', state, questions });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(250 * 2 ** attempt, 2000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(JEV_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`jev ${res.status}`);
        continue;
      }
      if (!res.ok) throw new FatalJevError(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { answers?: Record<string, JevAnswer> };
      if (!data?.answers) throw new Error('jev: no answers');
      return data.answers;
    } catch (e) {
      if (e instanceof FatalJevError) throw e; // bad key / invalid request — retrying won't help
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error('jev unavailable');
}

class FatalJevError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Confidence of a choice answer, tolerating responses that only carry probabilities. */
export function choiceConfidence(a: JevAnswer | undefined): number {
  if (!a?.choice) return 0;
  if (typeof a.confidence === 'number') return a.confidence;
  return a.probabilities?.[a.choice] ?? 0;
}
