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
  merchant_norm?: string | null;
  merchant_raw?: string | null; // bank's original name when a nickname is applied
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

// Requests time out after 30s. `fetch` in React Native has no default timeout, so
// a stalled connection (slow first TLS handshake, a dead network) would otherwise
// hang a screen forever — this is what left onboarding stuck on "Setting up…".
const DEFAULT_TIMEOUT_MS = 30_000;

async function req<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { backendUrl, apiToken } = await getSettings();
  if (!backendUrl) throw new Error('Backend URL not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${backendUrl}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
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

export interface Runway {
  balance: number | null;
  balanceAsOf: string | null;
  dailyBurn: number;
  spentWindow: number;
  windowDays: number;
  runwayDays: number | null;
}

export async function fetchRunway(days?: number): Promise<Runway> {
  return req<Runway>(`/analytics/runway${days ? `?days=${days}` : ''}`);
}

export interface MerchantAlias {
  pattern: string;
  display_name: string;
}

export async function fetchAliases(): Promise<MerchantAlias[]> {
  const data = await req<{ aliases: MerchantAlias[] }>('/aliases');
  return data.aliases;
}

/** Name a payee — applies to its whole history and every future payment. */
export async function setAlias(merchant: string, displayName: string): Promise<number> {
  const data = await req<{ patterns: number }>('/aliases', {
    method: 'POST',
    body: JSON.stringify({ merchant, displayName }),
  });
  return data.patterns;
}

export async function clearAlias(pattern: string): Promise<void> {
  await req(`/aliases/${encodeURIComponent(pattern)}`, { method: 'DELETE' });
}

export interface RecurringSuggestion {
  merchant: string;
  pattern: string;
  amount: number;
  dayOfCycle: number;
  frequency: 'monthly' | 'weekly';
  occurrences: number;
  category: string;
  lastSeen: string;
  confidence: number;
}

export async function fetchRecurringSuggestions(): Promise<RecurringSuggestion[]> {
  const data = await req<{ suggestions: RecurringSuggestion[] }>('/mandates/suggestions');
  return data.suggestions;
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
  emi_total: number | null; // tenure (installment count); null = open-ended mandate, not an EMI
  emi_start: string | null; // ISO date of the first installment (EMI only)
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

/** Fetch a report's rendered HTML as text (for offline caching + WebView). When
 * fetching 'latest', pass a `type` to scope to weekly/monthly. */
export async function fetchReportHtml(idOrLatest: string, type?: 'weekly' | 'monthly'): Promise<string> {
  const { backendUrl, apiToken } = await getSettings();
  if (!backendUrl) throw new Error('Backend URL not configured');
  const q = idOrLatest === 'latest' && type ? `?type=${type}` : '';
  const res = await fetch(`${backendUrl}/reports/${idOrLatest}${q}`, {
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

/* ─────────────────────────── Learning check-ins ─────────────────────────── */

export interface AssistantMessage {
  id: string;
  thread: string;
  role: 'user' | 'assistant';
  content: string;
  meta: string | null;
  created_at: string;
}

export interface LearningMessageResult {
  day: string;
  accepted: boolean;
  justAccepted: boolean;
  reason?: string | null;
  source?: string;
  reply: AssistantMessage;
}

/** Send a learning check-in / chat message. Until the day is accepted this is a
 * check-in attempt; a rejected attempt comes back accepted:false + a reason. */
export async function sendLearningMessage(text: string, opts?: { day?: string; topic?: string }): Promise<LearningMessageResult> {
  return req('/learning/message', { method: 'POST', body: JSON.stringify({ text, ...opts }) });
}

export async function fetchLearningThread(day: string): Promise<{ day: string; accepted: boolean; messages: AssistantMessage[] }> {
  return req(`/learning/thread/${day}`);
}

export interface CheckinRow {
  id: string; day: string; topic: string | null; text: string;
  word_count: number; accepted: number; verdict_source: string | null; reason: string | null; created_at: string;
}

export async function fetchCheckins(limit = 60): Promise<{ checkins: CheckinRow[]; streak: number }> {
  return req(`/learning/checkins?limit=${limit}`);
}

/* ─────────────────────────── Focus / blanket ─────────────────────────── */

export interface BlanketResult {
  verified: boolean;
  failOpen: boolean;
  reason: string;
  day: string;
  eventId: string;
  detail?: Record<string, unknown>;
}

export async function submitBlanket(imageBase64: string, mimeType = 'image/jpeg', day?: string): Promise<BlanketResult> {
  return req('/focus/blanket', { method: 'POST', body: JSON.stringify({ imageBase64, mimeType, day }) });
}

export interface FocusEvent {
  id: string; kind: string; day: string; ok: number; fail_open: number;
  reason: string | null; detail: string | null; r2_key: string | null; created_at: string;
}

export async function fetchBlanketEvents(limit = 30): Promise<FocusEvent[]> {
  const data = await req<{ events: FocusEvent[] }>(`/focus/blanket?limit=${limit}`);
  return data.events;
}

/* ─────────────────────────── Statements ─────────────────────────── */

export interface StatementSummary {
  id: string; file_name: string | null; bank: string | null; account_tail: string | null;
  period_start: string; period_end: string; row_count: number; debit_count: number; credit_count: number;
  balance_checked: number; balance_ok: number; parser: string; status: 'pending' | 'applied';
  added: number; removed: number; created_at: string; applied_at: string | null;
}

export interface StatementItem {
  id: string; statement_id: string; kind: 'add' | 'remove' | 'match'; txn_id: string | null;
  date: string | null; amount: number; description: string | null; merchant: string | null;
  category: string | null; ref: string | null; balance: number | null;
  suggested: 'approve' | 'deny' | null; decision: 'approved' | 'denied' | null; note: string | null; created_at: string;
}

export interface StatementDetail { statement: StatementSummary; items: StatementItem[]; }

/** Send extracted statement text (one string per page) for parsing + reconciliation. */
export async function parseStatement(input: { fileName?: string; pages?: string[]; images?: string[] }): Promise<StatementDetail> {
  return req('/statements/parse', { method: 'POST', body: JSON.stringify(input) });
}

export async function fetchStatements(): Promise<StatementSummary[]> {
  const data = await req<{ statements: StatementSummary[] }>('/statements');
  return data.statements;
}

export async function fetchStatement(id: string): Promise<StatementDetail> {
  return req(`/statements/${id}`);
}

export type StatementDecision = 'approve' | 'deny' | { decision: 'approve' | 'deny'; category?: string };

export async function applyStatement(id: string, decisions: Record<string, StatementDecision>): Promise<StatementDetail & { added: number; removed: number }> {
  return req(`/statements/${id}/apply`, { method: 'POST', body: JSON.stringify({ decisions }) });
}

/* ─────────────────────────── Flashcards ─────────────────────────── */

export interface QuizCard {
  id: string;
  question: string;
  options: string[];
  difficulty: string;
}

/** Import a shared ChatGPT conversation into flashcards. The phone fetches the
 * share HTML itself (ChatGPT blocks Cloudflare Worker egress) and sends it up. */
export async function importFlashcards(url: string, topic = 'inference engineering'): Promise<{ added: number; total: number; title?: string; alreadyImported?: boolean }> {
  let html: string | undefined;
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        accept: 'text/html',
      },
    });
    if (res.ok) html = await res.text();
  } catch {
    /* fall back to server-side fetch */
  }
  return req('/flashcards/import', { method: 'POST', body: JSON.stringify({ url, topic, html }), timeoutMs: 60000 });
}

export async function flashcardCount(): Promise<number> {
  const d = await req<{ count: number }>('/flashcards/count');
  return d.count;
}

export async function fetchQuiz(n = 5): Promise<{ count: number; cards: QuizCard[] }> {
  return req(`/flashcards/quiz?n=${n}`);
}

export async function gradeQuiz(answers: Record<string, number>): Promise<{ passed: boolean; correct: number; total: number }> {
  return req('/flashcards/grade', { method: 'POST', body: JSON.stringify({ answers }) });
}
