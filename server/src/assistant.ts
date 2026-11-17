import { jevDecide, jevEnabled } from './jev';
import { llmEnabled, llmJson, type ChatMessage } from './llm';
import type { Env } from './types';

/* ───────────────────────── Learning check-in validation ───────────────────────── */

export const MIN_CHECKIN_WORDS = 15;

/** Words that contain at least one letter — "123 !!! ..." doesn't pad the count. */
export function countWords(text: string): number {
  return (text.match(/[\p{L}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const tokens = (t: string) => (t.toLowerCase().match(/[\p{L}][\p{L}\p{N}'’-]*/gu) ?? []);

/** Jaccard similarity of the word sets of two texts (0..1). */
export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Deterministic checks that run before (and without) any model: minimum length,
 * keyboard-mash / no-vowel tokens, one word repeated to pad the count, and a
 * copy-paste of an earlier check-in. Also the whole validator when every model
 * is down, so the 15-word rule and the obvious-junk rules can never be skipped.
 */
export function localCheckinVerdict(text: string, recent: string[] = []): Verdict {
  const words = tokens(text);
  const n = countWords(text);
  if (n < MIN_CHECKIN_WORDS) {
    return { ok: false, reason: `Write at least ${MIN_CHECKIN_WORDS} words — you wrote ${n}.` };
  }
  const unique = new Set(words);
  if (unique.size / words.length < 0.45) {
    return { ok: false, reason: 'That repeats the same few words. Describe what you actually did.' };
  }
  // Latin-script tokens with no vowels (qwrtpsdf), or absurdly long runs.
  const junk = words.filter((w) => (/^[a-z]+$/.test(w) && w.length >= 4 && !/[aeiouy]/.test(w)) || w.length > 22);
  if (junk.length / words.length > 0.2) {
    return { ok: false, reason: 'That looks like keyboard mashing, not an update.' };
  }
  // Long runs of one character ("aaaaaa", "hahahahaha" is fine at ≤5).
  if (/(\p{L})\1{5,}/u.test(text)) {
    return { ok: false, reason: 'That looks like filler text, not an update.' };
  }
  for (const r of recent) {
    if (similarity(text, r) >= 0.8) {
      return { ok: false, reason: 'That is (almost) the same as an earlier check-in. Write about today.' };
    }
  }
  return { ok: true };
}

export interface CheckinValidation {
  accepted: boolean;
  reason: string | null;
  source: 'local' | 'jev' | 'llm' | 'fail-open';
  scores?: Record<string, number>;
}

/**
 * Validate a daily learning update: local rules first (always), then Jev decides
 * "is this a genuine update or a genuine reason for not studying?" and "is this
 * gibberish?". If Jev is unavailable after its retries the LLM judges instead; if
 * that fails too the update is accepted (the user's rule: never lock them out
 * because the AI is down) — the local rules still applied.
 */
export async function validateCheckin(
  env: Env,
  args: { text: string; topic: string; recent: string[] },
): Promise<CheckinValidation> {
  const local = localCheckinVerdict(args.text, args.recent);
  if (!local.ok) return { accepted: false, reason: local.reason, source: 'local' };

  if (jevEnabled(env)) {
    try {
      const a = await jevDecide(
        env,
        { learning_topic: args.topic, daily_update: args.text },
        {
          genuine: {
            type: 'noul',
            instructions:
              'The user was asked "What did you learn today?" about their learning topic. Is daily_update a genuine, coherent answer — either a description of what they studied, practised, built or read today (the topic can be any sub-area), or an honest explanation of why they could not study today?',
            criteria: {
              true: 'A real, meaningful update or a real reason for not studying, written in sentences that make sense',
              false: 'Gibberish, random or unrelated words, placeholder/filler text, lorem ipsum, or text that does not answer the question',
            },
          },
          gibberish: {
            type: 'noul',
            instructions: 'Is daily_update gibberish, keyboard mashing, or a string of words that does not form meaningful sentences?',
            criteria: { true: 'Gibberish or meaningless', false: 'Meaningful language' },
          },
        },
        { retries: 3 },
      );
      const genuine = a.genuine?.noul ?? 0;
      const gibberish = a.gibberish?.noul ?? 1;
      const scores = { genuine, gibberish };
      if (gibberish >= 0.5) return { accepted: false, reason: "That doesn't read as real sentences. Try again in your own words.", source: 'jev', scores };
      if (genuine < 0.5) {
        return {
          accepted: false,
          reason: `That doesn't describe your ${args.topic} progress today. Say what you learned, or why you couldn't study.`,
          source: 'jev',
          scores,
        };
      }
      return { accepted: true, reason: null, source: 'jev', scores };
    } catch {
      /* fall through to the LLM */
    }
  }

  if (llmEnabled(env)) {
    try {
      const v = await llmJson<{ valid: boolean; reason?: string }>(env, [
        {
          role: 'system',
          content: [
            `You check a daily learning check-in. The user is learning: ${args.topic}.`,
            'VALID: a coherent description of what they learned/practised today, OR an honest reason they could not study today.',
            'INVALID: gibberish, random words, filler, lorem ipsum, or text that does not answer "what did you learn today?".',
            'Return ONLY JSON: {"valid":true|false,"reason":"<one short sentence addressed to the user if invalid>"}',
          ].join('\n'),
        },
        { role: 'user', content: args.text },
      ], { retries: 3, timeoutMs: 12000 });
      return v.valid
        ? { accepted: true, reason: null, source: 'llm' }
        : { accepted: false, reason: v.reason || "That doesn't look like a real update.", source: 'llm' };
    } catch {
      /* fall through to fail-open */
    }
  }
  return { accepted: true, reason: null, source: 'fail-open' };
}

/**
 * The assistant's chat reply: specific acknowledgement + one follow-up question
 * or tip (or, on a skipped day, a small plan for tomorrow). Plain text. Falls
 * back to a canned line if the LLM is down — the check-in itself is already saved.
 */
export async function coachReply(
  env: Env,
  args: { topic: string; history: { role: 'user' | 'assistant'; content: string }[]; mode: 'accepted' | 'chat' },
): Promise<string> {
  if (!llmEnabled(env)) return fallbackReply(args.mode);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        `You are the user's personal learning coach inside their assistant app. They are learning ${args.topic}.`,
        'Every night they report their progress. Reply in 2–4 short sentences, warm but direct, at most one emoji.',
        args.mode === 'accepted'
          ? 'Acknowledge something SPECIFIC from their update. Then either ask one probing follow-up question that checks real understanding, or give one concrete next step. If they could not study, be kind, and suggest one tiny, specific thing for tomorrow.'
          : 'Continue the conversation: answer their question or react to their answer accurately and concisely. If they answered your earlier question, say whether it is right and add one insight.',
        'Plain text only.',
      ].join('\n'),
    },
    ...args.history.slice(-12).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];
  try {
    const text = await llmJson<string>(env, messages, { json: false, temperature: 0.6, retries: 2, timeoutMs: 15000 });
    return String(text).trim().slice(0, 1500) || fallbackReply(args.mode);
  } catch {
    return fallbackReply(args.mode);
  }
}

function fallbackReply(mode: 'accepted' | 'chat'): string {
  return mode === 'accepted'
    ? "Logged — thanks for checking in. Keep the streak going tomorrow."
    : "I couldn't reach the AI just now — your message is saved. Try again in a bit.";
}

/* ───────────────────────────── Folded-blanket check ───────────────────────────── */

export interface BlanketVerdict {
  verified: boolean;
  failOpen: boolean;
  reason: string;
  detail?: Record<string, unknown>;
}

/**
 * Morning gate: is there a GREEN blanket in this camera photo, and is it folded
 * (any style, even sloppy)? Also rejects photos of a screen or a printout so an
 * old picture can't be replayed. 1 try + 3 retries on the vision model; if all of
 * them fail, the gate opens (failOpen) — the user's rule.
 */
export async function verifyBlanket(env: Env, imageBase64: string, mimeType = 'image/jpeg'): Promise<BlanketVerdict> {
  if (!llmEnabled(env)) {
    return { verified: true, failOpen: true, reason: 'Vision model not configured — allowed.' };
  }
  const prompt = [
    'This photo was just taken with the phone camera as proof of a morning habit: the user must fold their GREEN blanket.',
    'Be lenient about HOW it is folded — the user explicitly accepts sloppy or partial folding. Judge:',
    '- blanket_visible: is a blanket / comforter / quilt / duvet clearly visible?',
    '- is_green: is that blanket predominantly green (any shade: olive, mint, dark, bright, teal-green)?',
    '- fold_state: "folded" if it has been folded at all — halves, quarters, thirds, rolled, stacked, or a corner flipped over a folded stack; a smaller-than-bed rectangle showing layered edges or a fold line counts. "spread" if laid out at full size (e.g. covering the bed). "crumpled" if bunched in a heap. "in_use" if around/over a person.',
    '- is_real_scene: is this a direct photo of a real scene (not a photo of a phone/computer screen, TV, or a printed picture)?',
    'Return ONLY minified JSON: {"blanket_visible":bool,"is_green":bool,"fold_state":"folded"|"spread"|"crumpled"|"in_use"|"none","is_real_scene":bool,"confidence":0..1,"reason":"<one short sentence to the user>"}',
  ].join('\n');
  try {
    const r = await llmJson<Record<string, any>>(
      env,
      [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      }],
      { retries: 3, timeoutMs: 25000 },
    );
    const folded = r.fold_state === 'folded' || r.is_folded === true;
    const verified = !!(r.blanket_visible && r.is_green && folded && r.is_real_scene !== false);
    let reason = String(r.reason ?? '').slice(0, 240);
    if (!reason) {
      reason = verified ? 'Folded green blanket spotted.' : 'Could not confirm a folded green blanket.';
    }
    return { verified, failOpen: false, reason, detail: r };
  } catch (e: any) {
    return { verified: true, failOpen: true, reason: `AI check unavailable after 3 retries (${String(e?.message ?? e).slice(0, 80)}) — allowed.` };
  }
}
