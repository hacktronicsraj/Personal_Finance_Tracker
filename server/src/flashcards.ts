import { llmJson } from './llm';
import type { Env } from './types';

/**
 * Flashcards from shared ChatGPT conversations.
 *
 * A ChatGPT share link (chatgpt.com/share/<id>) is a public, client-rendered
 * page: the conversation is embedded in the React-Router turbo-stream, not in
 * plain HTML, and the backend-api/share endpoint is Cloudflare-bot-blocked. So we
 * fetch the share PAGE, pull the natural-language strings out of the stream, and
 * hand that text to the LLM to write multiple-choice flashcards. MCQs (not
 * free-text) so the Instagram gate can grade them deterministically with no AI.
 */

export interface Flashcard {
  question: string;
  options: string[]; // exactly 4
  answer: number; // 0..3
  difficulty: 'medium' | 'hard';
}

const SHARE_RE = /(?:chatgpt\.com|chat\.openai\.com)\/share\/([0-9a-f-]{16,})/i;

export function shareId(url: string): string | null {
  return url.match(SHARE_RE)?.[1] ?? null;
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Boilerplate strings the share page injects that aren't conversation content. */
const BOILERPLATE_RE =
  /shared part of their work|usage limit|upgrade to pro|purchase more credits|try again at|this conversation may|chatgpt can make mistakes|log in to|sign up|by messaging chatgpt/i;

/**
 * Pull the conversation text out of a ChatGPT share page's HTML. The stream
 * interns strings and references them by index, so we don't reconstruct turns —
 * we collect the substantive natural-language strings, which are the questions and
 * answers. Returns '' if nothing usable is found.
 */
export function extractShareText(htmlDoc: string): string {
  const chunks = [...htmlDoc.matchAll(/streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]);
  let blob = '';
  for (const c of chunks) {
    try {
      blob += JSON.parse('"' + c + '"');
    } catch {
      blob += c;
    }
  }
  if (!blob) blob = htmlDoc;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of blob.matchAll(/"((?:[^"\\]|\\.){40,})"/g)) {
    let s = m[1];
    try {
      s = JSON.parse('"' + s + '"');
    } catch {
      /* keep raw */
    }
    s = s.trim();
    if (s.split(' ').length < 6) continue; // not a sentence
    if (!/[a-zA-Z]/.test(s) || s.startsWith('http') || s.startsWith('{')) continue;
    if (BOILERPLATE_RE.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.join('\n\n');
}

export interface FetchedConversation {
  text: string;
  title: string | null;
}

/** Fetch a ChatGPT share link and extract its conversation text + title. */
export async function fetchShareConversation(url: string): Promise<FetchedConversation> {
  const id = shareId(url);
  if (!id) throw new Error('Not a ChatGPT share link.');
  const res = await fetch(`https://chatgpt.com/share/${id}`, {
    headers: { 'user-agent': UA, accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`Could not open the share link (${res.status}).`);
  const doc = await res.text();
  const title = doc.match(/<title>([^<]*)<\/title>/i)?.[1]?.replace(/\s*[-–|]\s*ChatGPT.*$/i, '').trim() || null;
  const text = extractShareText(doc);
  if (text.length < 200) throw new Error('That conversation had no readable content to make cards from.');
  return { text, title };
}

/**
 * Generate `count` medium/hard multiple-choice flashcards grounded in the text.
 * Each has 4 options and one correct answer. The LLM is told to make the
 * distractors plausible so the cards actually test understanding.
 */
export async function generateFlashcards(env: Env, text: string, topic: string, count = 12): Promise<Flashcard[]> {
  // Cap the input so a huge conversation still fits the model context.
  const material = text.slice(0, 16000);
  const system = [
    'You write exam-style multiple-choice flashcards from study material.',
    `Make exactly ${count} cards testing real understanding of the material below (topic: ${topic}).`,
    'Difficulty: MEDIUM to HARD — no trivially-guessable questions; test concepts, reasoning, and specifics, not surface recall.',
    'Each card: a clear question, exactly 4 options, one correct, three plausible-but-wrong distractors.',
    'Only use facts supported by the material. Do not invent unrelated content.',
    'Return ONLY minified JSON: {"cards":[{"question":str,"options":[str,str,str,str],"answer":0-3,"difficulty":"medium"|"hard"}]}',
  ].join('\n');
  const data = await llmJson<{ cards: any[] }>(
    env,
    [
      { role: 'system', content: system },
      { role: 'user', content: material },
    ],
    { retries: 2, timeoutMs: 45000 },
  );
  const cards: Flashcard[] = [];
  for (const c of data?.cards ?? []) {
    const options = Array.isArray(c?.options) ? c.options.map((o: unknown) => String(o).trim()).filter(Boolean) : [];
    const answer = Number(c?.answer);
    if (!c?.question || options.length !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3) continue;
    cards.push({
      question: String(c.question).trim().slice(0, 500),
      options: options.slice(0, 4),
      answer,
      difficulty: c.difficulty === 'hard' ? 'hard' : 'medium',
    });
  }
  return cards;
}
