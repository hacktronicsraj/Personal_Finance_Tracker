import { getSettings } from '../settings';
import type { ParsedTxn } from '../parse/types';
import type { TagTotal, TxnFilters } from '../txns';

export { filterTxns, parseTags } from '../txns';
export type { TagTotal, TxnFilters, FilterableTxn } from '../txns';

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
  user_note: string | null;
  tags: string | null; // JSON array string e.g. '["trip","work"]'
  mandate_id: string | null;
  source: string; // 'sms' | 'shared' | 'manual'
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
  note?: string;
  tags?: string[];
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

/** Build a query string from only the defined, non-empty params (skips `undefined`,
 * which URLSearchParams would otherwise serialize as the literal string "undefined"). */
function toQuery(params?: Record<string, string | number | undefined | null>): string {
  const entries = Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
  return qs ? `?${qs}` : '';
}

export async function fetchTransactions(params?: TxnFilters): Promise<TxnRow[]> {
  const query = toQuery({
    from: params?.from,
    to: params?.to,
    category: params?.category,
    categories: params?.categories?.length ? params.categories.join(',') : undefined,
    q: params?.q,
    minAmount: params?.minAmount,
    maxAmount: params?.maxAmount,
    source: params?.source,
    tag: params?.tag,
  });
  const data = await req<{ transactions: TxnRow[] }>(`/transactions${query}`);
  return data.transactions;
}

/** Apply a user edit (any subset of category/merchant/amount/note/tags). */
export async function patchTransaction(
  id: string,
  fields: { category?: string; merchant?: string | null; amount?: number; note?: string | null; tags?: string[] },
): Promise<TxnRow> {
  const data = await req<{ transaction: TxnRow }>(`/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
  return data.transaction;
}

export async function updateCategory(id: string, category: string): Promise<TxnRow> {
  return patchTransaction(id, { category });
}

export async function deleteTransaction(id: string): Promise<void> {
  await req(`/transactions/${id}`, { method: 'DELETE' });
}

export async function fetchSummary(params?: { from?: string; to?: string }): Promise<AnalyticsSummary> {
  return req<AnalyticsSummary>(`/analytics/summary${toQuery(params)}`);
}

export async function fetchTagAnalytics(params?: { from?: string; to?: string }): Promise<TagTotal[]> {
  const data = await req<{ tags: TagTotal[] }>(`/analytics/tags${toQuery(params)}`);
  return data.tags;
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

export interface RuleRow {
  id: string;
  pattern: string;
  category: string;
  source: 'learned' | 'manual';
  hit_count: number;
}

export async function fetchRules(): Promise<RuleRow[]> {
  const data = await req<{ rules: RuleRow[] }>('/rules');
  return data.rules;
}

export async function createManualRule(pattern: string, category: string): Promise<void> {
  await req('/rules', { method: 'POST', body: JSON.stringify({ pattern, category }) });
}

export async function updateRuleCategory(id: string, category: string): Promise<void> {
  await req(`/rules/${id}`, { method: 'PATCH', body: JSON.stringify({ category }) });
}

export async function deleteRuleAPI(id: string): Promise<void> {
  await req(`/rules/${id}`, { method: 'DELETE' });
}

export interface MandateRow {
  id: string;
  name: string;
  platform: 'gpay' | 'phonepe' | 'paytm' | 'bank_autopay' | 'card' | 'other';
  amount: number;
  day_of_cycle: number;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  category: string;
  merchant_hint: string | null;
  active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchMandates(): Promise<MandateRow[]> {
  const data = await req<{ mandates: MandateRow[] }>('/mandates');
  return data.mandates;
}

export async function createMandate(m: Omit<MandateRow, 'id' | 'active' | 'created_at' | 'updated_at'>): Promise<void> {
  await req('/mandates', { method: 'POST', body: JSON.stringify(m) });
}

export async function patchMandate(id: string, fields: Partial<MandateRow>): Promise<void> {
  await req(`/mandates/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
}

export async function deleteMandate(id: string): Promise<void> {
  await req(`/mandates/${id}`, { method: 'DELETE' });
}

export interface AttachmentMeta {
  id: string;
  txn_id: string;
  r2_key: string;
  mime: string | null;
  size: number | null;
  created_at: string;
}

export async function fetchAttachments(txnId: string): Promise<AttachmentMeta[]> {
  const data = await req<{ attachments: AttachmentMeta[] }>(`/transactions/${txnId}/attachments`);
  return data.attachments;
}

export async function uploadAttachment(txnId: string, base64: string, mime: string): Promise<AttachmentMeta> {
  const data = await req<{ attachment: AttachmentMeta }>(`/transactions/${txnId}/attachments`, {
    method: 'POST',
    body: JSON.stringify({ base64, mime }),
  });
  return data.attachment;
}

export async function deleteAttachment(id: string): Promise<void> {
  await req(`/attachments/${id}`, { method: 'DELETE' });
}

/** Build an authed image source for RN <Image> (streams bytes from the Worker/R2). */
export async function attachmentSource(id: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const { backendUrl, apiToken } = await getSettings();
  return {
    uri: `${backendUrl}/attachments/${id}`,
    headers: apiToken ? { authorization: `Bearer ${apiToken}` } : {},
  };
}

export interface ReportMeta {
  id: string;
  period_start: string;
  period_end: string;
  period_type: 'weekly' | 'monthly';
  summary_json: string | null;
  created_at: string;
}

export async function fetchReports(): Promise<ReportMeta[]> {
  const data = await req<{ reports: ReportMeta[] }>('/reports');
  return data.reports;
}

/** Fetch a report's rendered HTML as text (for offline caching + WebView). */
export async function fetchReportHtml(idOrLatest: string): Promise<string> {
  const { backendUrl, apiToken } = await getSettings();
  if (!backendUrl) throw new Error('Backend URL not configured');
  const res = await fetch(`${backendUrl}/reports/${idOrLatest}`, {
    headers: apiToken ? { authorization: `Bearer ${apiToken}` } : {},
  });
  if (!res.ok) throw new Error(`report ${res.status}`);
  return res.text();
}

/** Trigger server-side report generation. Monthly supports `offset` whole months
 * back (0 = this month so far, 1 = last month…); weekly ignores it. */
export async function generateReport(type: 'weekly' | 'monthly' = 'weekly', offset = 0): Promise<ReportMeta> {
  const data = await req<{ report: ReportMeta }>('/reports/generate', {
    method: 'POST',
    body: JSON.stringify({ type, offset }),
  });
  return data.report;
}

export async function health(): Promise<{ ok: boolean; mode: string }> {
  return req('/health');
}
