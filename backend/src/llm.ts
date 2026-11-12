import type { Env } from './types';

export type ChatContent =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

function primaryEnabled(env: Env): boolean {
  return env.LLM_MODE !== 'mock' && !!env.LLM_API_KEY && !!env.LLM_BASE_URL;
}
export function llmEnabled(env: Env): boolean {
  return env.LLM_MODE !== 'mock' && (primaryEnabled(env) || !!env.AI);
}

class HardError extends Error {}

/**
 * One chat completion, parsed as JSON (or raw text with json:false). Primary
 * provider (Gemini) first, then the Workers AI fallback — so a dead/absent key
 * still works. Throws only when both are exhausted.
 */
export async function llmJson<T = any>(
  env: Env,
  messages: ChatMessage[],
  opts: { model?: string; retries?: number; timeoutMs?: number; json?: boolean; temperature?: number } = {},
): Promise<T> {
  if (!llmEnabled(env)) throw new Error('llm not configured');
  const retries = opts.retries ?? 2;
  let primaryErr: unknown = null;
  if (primaryEnabled(env)) {
    try {
      return await withRetries(retries, () => primaryCall<T>(env, messages, opts));
    } catch (e) {
      primaryErr = e;
    }
  }
  if (env.AI) return withRetries(retries, () => workersAiCall<T>(env, messages, opts));
  throw primaryErr ?? new Error('LLM unavailable');
}

async function withRetries<T>(retries: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(600 * 2 ** (attempt - 1), 4000)));
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HardError) throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('LLM unavailable');
}

async function primaryCall<T>(env: Env, messages: ChatMessage[], opts: any): Promise<T> {
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

async function workersAiCall<T>(env: Env, messages: ChatMessage[], opts: any): Promise<T> {
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
    return (opts.json === false ? JSON.stringify(content) : content) as T;
  }
  return parseOutput<T>(String(content), opts.json);
}

function parseOutput<T>(content: string, json?: boolean): T {
  if (json === false) return content as T;
  return JSON.parse(extractJson(content)) as T;
}

export function extractJson(s: string): string {
  const t = s.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1];
  if (t.startsWith('{') || t.startsWith('[')) return t;
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return a >= 0 && b > a ? t.slice(a, b + 1) : t;
}
