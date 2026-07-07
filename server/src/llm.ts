import { CATEGORIES, isCategory } from './categories';
import { ruleClassify } from './classify';
import type { Classification, Env, FewShot, ParsedTxn } from './types';

function buildMessages(input: ParsedTxn & { rawText: string }, fewshot: FewShot[]) {
  const system = [
    'You classify a single bank/UPI transaction into exactly one category.',
    `Allowed categories: ${CATEGORIES.join(', ')}.`,
    'Return ONLY minified JSON: {"category":<one allowed category>,"merchant":<clean merchant name>,"confidence":<0..1>,"notes":<short>}.',
    'Rules: "debit" = money leaving the account (a purchase/payment). "credit" = money received.',
    'For UPI messages the payee name usually appears right before the word "credited"; that payee IS the merchant.',
    'Normalize truncated merchant names (e.g. "Groww Invest Te" -> "Groww").',
  ].join('\n');

  const examples = fewshot
    .filter((f) => f.corrected_category && isCategory(f.corrected_category))
    .slice(0, 12);

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
  ];
  for (const ex of examples) {
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

export async function classifyTxn(
  env: Env,
  input: ParsedTxn & { rawText: string },
  fewshot: FewShot[] = [],
): Promise<Classification> {
  const useLive = env.LLM_MODE !== 'mock' && !!env.LLM_API_KEY && !!env.LLM_BASE_URL;
  if (!useLive) return ruleClassify(input);

  const url = `${env.LLM_BASE_URL!.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: env.LLM_MODEL ?? 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: buildMessages(input, fewshot),
  });

  // Up to 2 attempts, each capped at 8s. Retry only transient errors (429/5xx/
  // timeout) — Gemini free tier throws 503 under load. Fail fast to rules
  // otherwise so classify never hangs the app.
  const TIMEOUT_MS = 8000;
  const MAX_ATTEMPTS = 2;
  try {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`LLM ${res.status}`);
          continue; // transient — retry
        }
        if (!res.ok) throw new Error(`LLM ${res.status}`); // 4xx (e.g. bad key) — don't retry
        return parseLlmResponse(await res.json(), input);
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        // AbortError / network — retry
      }
    }
    throw lastErr ?? new Error('LLM unavailable');
  } catch (err) {
    // Never fail a transaction because the LLM is down — fall back to rules.
    const fb = ruleClassify(input);
    return { ...fb, notes: `${fb.notes};llm-fallback` };
  }
}

export interface ExtractedPayment {
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null; // ISO date
  direction: 'debit' | 'credit';
  currency: string;
}

/**
 * Read a shared UPI/GPay/PhonePe/Paytm payment-receipt SCREENSHOT with the vision
 * model (Gemini Flash is multimodal via the same OpenAI-compatible endpoint) and
 * pull out the payment. GPay's share is an image with the amount baked into pixels,
 * so there's no text to parse — this is how those get captured.
 *
 * Throws when no live vision model is configured or the call fails, so the caller
 * can fall back to a blank manual-entry confirm screen instead of losing the share.
 */
export async function extractFromImage(
  env: Env,
  imageBase64: string,
  mimeType = 'image/jpeg',
): Promise<ExtractedPayment> {
  const useLive = env.LLM_MODE !== 'mock' && !!env.LLM_API_KEY && !!env.LLM_BASE_URL;
  if (!useLive) throw new Error('vision model not configured');

  const prompt = [
    'This is a screenshot of a UPI payment receipt (Google Pay / PhonePe / Paytm / a bank app).',
    'Extract the single transaction shown.',
    'Return ONLY minified JSON: {"amount":<number>,"merchant":<who was paid/received, clean name>,"occurredAt":<ISO 8601 date or null>,"direction":<"debit" if money was PAID/SENT, "credit" if RECEIVED>,"currency":"INR"}.',
    'amount is the rupee figure of the payment (no commas, no ₹). If you cannot read an amount, use null.',
    'merchant is the payee for a debit, or the sender for a credit.',
  ].join('\n');

  const url = `${env.LLM_BASE_URL!.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: env.LLM_MODEL ?? 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ],
      },
    ],
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000); // vision is slower than text
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`vision LLM ${res.status}`);
    const data: any = await res.json();
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
    const amount = Number(String(parsed.amount ?? '').replace(/[, ₹]/g, ''));
    return {
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      merchant: parsed.merchant ? String(parsed.merchant).trim().slice(0, 120) : null,
      occurredAt: parsed.occurredAt ? String(parsed.occurredAt) : null,
      direction: parsed.direction === 'credit' ? 'credit' : 'debit',
      currency: 'INR',
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseLlmResponse(data: any, input: ParsedTxn & { rawText: string }): Classification {
  const content: string = data?.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content);
  const category = isCategory(parsed.category) ? parsed.category : 'Other';
  return {
    category,
    merchant: String(parsed.merchant ?? input.merchant ?? '').trim(),
    confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
    notes: parsed.notes ? String(parsed.notes).slice(0, 200) : 'llm',
  };
}
