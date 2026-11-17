import { CATEGORIES, CATEGORY_GUIDE, isCategory } from './categories';
import { ruleClassify } from './classify';
import { choiceConfidence, jevDecide, jevEnabled } from './jev';
import type { Classification, Env, FewShot, ParsedTxn } from './types';

/* ─────────────────────────────── Model plumbing ─────────────────────────────── */

export type ChatContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

/** The primary OpenAI-compatible provider (Gemini) is configured. */
function primaryEnabled(env: Env): boolean {
  return env.LLM_MODE !== 'mock' && !!env.LLM_API_KEY && !!env.LLM_BASE_URL;
}

/** Some model is reachable: the primary provider, or the Workers AI fallback. */
export function llmEnabled(env: Env): boolean {
  return env.LLM_MODE !== 'mock' && (primaryEnabled(env) || !!env.AI);
}

/**
 * One chat completion, parsed as JSON (or raw text with `json: false`).
 *
 * Primary provider first — 1 try + `retries` retries on transient failures
 * (429/5xx/timeouts/unparseable output). If the primary is unconfigured, out of
 * credit (402), or still failing, the same prompt goes to Workers AI with the
 * same retry budget. Throws only when both are exhausted, so each caller can
 * apply its own fallback policy.
 */
export async function llmJson<T = any>(
  env: Env,
  messages: ChatMessage[],
  opts: { model?: string; retries?: number; timeoutMs?: number; json?: boolean; temperature?: number } = {},
): Promise<T> {
  if (!llmEnabled(env)) throw new Error('llm not configured');
  const retries = opts.retries ?? 3;
  let primaryErr: unknown = null;
  if (primaryEnabled(env)) {
    try {
      return await withRetries(retries, () => primaryCall<T>(env, messages, opts));
    } catch (e) {
      primaryErr = e;
    }
  }
  if (env.AI) {
    return withRetries(retries, () => workersAiCall<T>(env, messages, opts));
  }
  throw primaryErr ?? new Error('LLM unavailable');
}

class HardError extends Error {}

async function withRetries<T>(retries: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(600 * 2 ** (attempt - 1), 4000)));
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HardError) throw e; // bad key / no credit / bad request — retrying won't help
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('LLM unavailable');
}

async function primaryCall<T>(
  env: Env,
  messages: ChatMessage[],
  opts: { model?: string; timeoutMs?: number; json?: boolean; temperature?: number },
): Promise<T> {
  const url = `${env.LLM_BASE_URL!.replace(/\/$/, '')}/chat/completions`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: opts.model ?? env.LLM_MODEL ?? 'gpt-4o-mini',
        temperature: opts.temperature ?? 0,
        ...(opts.json === false ? {} : { response_format: { type: 'json_object' } }),
        messages,
      }),
      signal: ctrl.signal,
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`LLM ${res.status}`);
    if (!res.ok) throw new HardError(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    return parseOutput<T>(data?.choices?.[0]?.message?.content ?? '', opts.json);
  } finally {
    clearTimeout(timer);
  }
}

async function workersAiCall<T>(
  env: Env,
  messages: ChatMessage[],
  opts: { timeoutMs?: number; json?: boolean; temperature?: number },
): Promise<T> {
  const model = env.AI_MODEL ?? '@cf/meta/llama-4-scout-17b-16e-instruct';
  const run = (env.AI as any).run(model, {
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: 8192,
    ...(opts.json === false ? {} : { response_format: { type: 'json_object' } }),
  });
  const out: any = await Promise.race([
    run,
    new Promise((_, rej) => setTimeout(() => rej(new Error('workers-ai timeout')), opts.timeoutMs ?? 30000)),
  ]);
  const content = out?.response ?? out?.choices?.[0]?.message?.content ?? out?.result?.response ?? '';
  if (typeof content === 'object' && content !== null) {
    if (opts.json === false) return JSON.stringify(content) as T;
    return content as T;
  }
  return parseOutput<T>(String(content), opts.json);
}

function parseOutput<T>(content: string, json?: boolean): T {
  if (json === false) return content as T;
  return JSON.parse(extractJson(content)) as T;
}

/** Tolerates ```json fences and prose around the object that JSON mode sometimes lets through. */
export function extractJson(s: string): string {
  const t = s.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1];
  if (t.startsWith('{') || t.startsWith('[')) return t;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}

/* ─────────────────────────────── Classification ─────────────────────────────── */

function buildMessages(input: ParsedTxn & { rawText: string }, fewshot: FewShot[]): ChatMessage[] {
  const system = [
    'You classify a single bank/UPI transaction into exactly one category.',
    'Categories:',
    ...CATEGORIES.map((c) => `- ${c}: ${CATEGORY_GUIDE[c]}`),
    'Return ONLY minified JSON: {"category":<one allowed category>,"merchant":<clean merchant name>,"confidence":<0..1>,"notes":<short>}.',
    'Rules: "debit" = money leaving the account (a purchase/payment). "credit" = money received.',
    'For UPI messages the payee name usually appears right before the word "credited"; that payee IS the merchant.',
    'Normalize truncated merchant names (e.g. "Groww Invest Te" -> "Groww").',
  ].join('\n');

  const messages: ChatMessage[] = [{ role: 'system', content: system }];
  for (const ex of fewshot.filter((f) => f.corrected_category && isCategory(f.corrected_category)).slice(0, 12)) {
    messages.push({ role: 'user', content: `SMS: ${ex.raw_text}\nmerchant: ${ex.merchant ?? ''}` });
    messages.push({
      role: 'assistant',
      content: JSON.stringify({ category: ex.corrected_category, merchant: ex.merchant ?? '', confidence: 0.95, notes: 'user-corrected' }),
    });
  }
  messages.push({
    role: 'user',
    content: `SMS: ${input.rawText}\namount: ${input.amount}\ndirection: ${input.direction}\nmerchant: ${input.merchant ?? ''}`,
  });
  return messages;
}

/**
 * Jev picks the category from the built-in taxonomy (it cannot answer outside
 * it). The user's recent corrections ride along in the instructions, the same
 * signal the LLM gets as few-shot turns.
 */
export async function jevClassify(
  env: Env,
  input: ParsedTxn & { rawText: string },
  fewshot: FewShot[] = [],
): Promise<Classification> {
  const examples = fewshot
    .filter((f) => f.corrected_category && isCategory(f.corrected_category))
    .slice(0, 12)
    .map((f) => ({ merchant: f.merchant, sms: f.raw_text?.slice(0, 160) ?? null, category: f.corrected_category }));
  const answers = await jevDecide(
    env,
    {
      sms: input.rawText || null,
      merchant: input.merchant ?? null,
      amount_inr: input.amount,
      direction: input.direction,
      when: input.occurredAt ?? null,
    },
    {
      category: {
        type: 'choice',
        instructions: examples.length
          ? { task: 'Which spending category does this Indian bank/UPI transaction belong to?', this_users_recent_labels: examples }
          : 'Which spending category does this Indian bank/UPI transaction belong to?',
        criteria: CATEGORY_GUIDE,
      },
    },
    { retries: 2, timeoutMs: 5000 },
  );
  const a = answers.category;
  const category = a?.choice && isCategory(a.choice) ? a.choice : 'Other';
  const confidence = Math.round(choiceConfidence(a) * 100) / 100;
  return { category, merchant: String(input.merchant ?? '').trim(), confidence, notes: `jev:${confidence}` };
}

async function llmClassify(env: Env, input: ParsedTxn & { rawText: string }, fewshot: FewShot[]): Promise<Classification> {
  const parsed = await llmJson<any>(env, buildMessages(input, fewshot), { retries: 1, timeoutMs: 8000 });
  return parseLlmResponse(parsed, input);
}

/**
 * Categorise one transaction. CLASSIFIER picks the engine:
 *   jev (default) — Jev; the LLM only if Jev errors
 *   hybrid        — Jev; also the LLM when Jev's confidence < 0.5
 *   llm           — the LLM only (the original behaviour)
 * Whatever happens, never fail a transaction: rules are the last resort.
 */
export async function classifyTxn(
  env: Env,
  input: ParsedTxn & { rawText: string },
  fewshot: FewShot[] = [],
): Promise<Classification> {
  if (env.LLM_MODE === 'mock') return ruleClassify(input);
  const mode = env.CLASSIFIER ?? 'jev';
  let jevResult: Classification | null = null;

  if (mode !== 'llm' && jevEnabled(env)) {
    try {
      jevResult = await jevClassify(env, input, fewshot);
      if (mode === 'jev' || jevResult.confidence >= 0.5 || !llmEnabled(env)) return jevResult;
    } catch {
      jevResult = null;
    }
  }
  if (llmEnabled(env)) {
    try {
      return await llmClassify(env, input, fewshot);
    } catch {
      /* fall through */
    }
  }
  if (jevResult) return jevResult;
  const fb = ruleClassify(input);
  return { ...fb, notes: `${fb.notes};llm-fallback` };
}

/* ─────────────────────────────── Receipt vision ─────────────────────────────── */

export interface ExtractedPayment {
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null; // ISO date
  direction: 'debit' | 'credit';
  currency: string;
}

/**
 * Read a shared UPI/GPay/PhonePe/Paytm payment-receipt SCREENSHOT with the vision
 * model and pull out the payment. GPay's share is an image with the amount baked
 * into pixels, so there's no text to parse — this is how those get captured.
 *
 * Throws when no vision model is reachable, so the caller can fall back to a
 * blank manual-entry confirm screen instead of losing the share.
 */
export async function extractFromImage(env: Env, imageBase64: string, mimeType = 'image/jpeg'): Promise<ExtractedPayment> {
  if (!llmEnabled(env)) throw new Error('vision model not configured');
  const prompt = [
    'This is a screenshot of a UPI payment receipt (Google Pay / PhonePe / Paytm / a bank app).',
    'Extract the single transaction shown.',
    'Return ONLY minified JSON: {"amount":<number>,"merchant":<who was paid/received, clean name>,"occurredAt":<ISO 8601 date or null>,"direction":<"debit" if money was PAID/SENT, "credit" if RECEIVED>,"currency":"INR"}.',
    'amount is the rupee figure of the payment (no commas, no ₹). If you cannot read an amount, use null.',
    'merchant is the payee for a debit, or the sender for a credit.',
  ].join('\n');
  const parsed = await llmJson<any>(
    env,
    [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      ],
    }],
    { retries: 1, timeoutMs: 20000 },
  );
  const amount = Number(String(parsed.amount ?? '').replace(/[, ₹]/g, ''));
  return {
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    merchant: parsed.merchant ? String(parsed.merchant).trim().slice(0, 120) : null,
    occurredAt: parsed.occurredAt ? String(parsed.occurredAt) : null,
    direction: parsed.direction === 'credit' ? 'credit' : 'debit',
    currency: 'INR',
  };
}

function parseLlmResponse(parsed: any, input: ParsedTxn & { rawText: string }): Classification {
  const category = isCategory(parsed?.category) ? parsed.category : 'Other';
  return {
    category,
    merchant: String(parsed?.merchant ?? input.merchant ?? '').trim(),
    confidence: typeof parsed?.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
    notes: parsed?.notes ? String(parsed.notes).slice(0, 200) : 'llm',
  };
}
