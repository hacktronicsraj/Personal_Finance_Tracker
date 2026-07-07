import { getSettings } from '../settings';
import type { ParsedTxn } from '../parse/types';

export interface TxnRow {
  id: string;
  raw_text: string;
  amount: number;
  direction: 'debit' | 'credit';
  currency: string;
  bank: string | null;
  merchant: string | null;
  account_tail: string | null;
  ref_no: string | null;
  balance: number | null;
  occurred_at: string | null;
  category: string;
  confidence: number;
  notes: string | null;
  corrected: number;
  created_at: string;
  updated_at: string;
}

export interface AnalyticsSummary {
  totalSpent: number;
  byCategory: { category: string; count: number; total: number }[];
  topMerchants: { merchant: string; count: number; total: number }[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const { backendUrl, apiToken } = await getSettings();
  if (!backendUrl) throw new Error('Backend URL not configured');
  const res = await fetch(`${backendUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function classify(input: {
  deviceId: string;
  rawText: string;
  dedupeKey: string;
  parsed: ParsedTxn;
  source?: string;
  category?: string; // user-chosen category (share/manual confirm) — server skips the LLM
}): Promise<{ transaction: TxnRow; deduped: boolean; merged?: boolean }> {
  return req('/classify', { method: 'POST', body: JSON.stringify(input) });
}

export interface ExtractedPayment {
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null;
  direction: 'debit' | 'credit';
  currency: string;
}

/** Read a shared payment screenshot (e.g. Google Pay's receipt image) via the backend vision model. */
export async function extractImage(imageBase64: string, mimeType: string): Promise<ExtractedPayment | null> {
  const data = await req<{ extracted: ExtractedPayment | null }>('/extract-image', {
    method: 'POST',
    body: JSON.stringify({ imageBase64, mimeType }),
  });
  return data.extracted;
}

export async function fetchTransactions(params?: {
  from?: string;
  to?: string;
  category?: string;
  q?: string;
}): Promise<TxnRow[]> {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  const data = await req<{ transactions: TxnRow[] }>(`/transactions${qs ? `?${qs}` : ''}`);
  return data.transactions;
}

export async function updateCategory(id: string, category: string): Promise<TxnRow> {
  const data = await req<{ transaction: TxnRow }>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ category }),
  });
  return data.transaction;
}

export async function fetchSummary(params?: { from?: string; to?: string }): Promise<AnalyticsSummary> {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return req<AnalyticsSummary>(`/analytics/summary${qs ? `?${qs}` : ''}`);
}

export async function syncSince(cursor: string): Promise<{ transactions: TxnRow[]; nextCursor: string }> {
  return req(`/sync?since=${encodeURIComponent(cursor)}`);
}

export interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  is_default: number;
}

export async function fetchCategories(): Promise<CategoryRow[]> {
  const data = await req<{ categories: CategoryRow[] }>('/categories');
  return data.categories;
}

export async function createCategory(name: string, color?: string): Promise<CategoryRow> {
  const data = await req<{ category: CategoryRow }>('/categories', {
    method: 'POST',
    body: JSON.stringify({ name, color }),
  });
  return data.category;
}

export async function health(): Promise<{ ok: boolean; mode: string }> {
  return req('/health');
}
