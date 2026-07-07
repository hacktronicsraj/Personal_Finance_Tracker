export interface ParsedTxn {
  amount: number;
  direction: 'debit' | 'credit';
  currency?: string;
  bank?: string;
  merchant?: string;
  accountTail?: string;
  refNo?: string;
  balance?: number;
  occurredAt?: string; // ISO-8601
}

export interface ClassifyRequest {
  deviceId?: string;
  rawText: string;
  dedupeKey?: string;
  parsed: ParsedTxn;
  // Capture channel: 'sms' (bank record-of-truth), 'gpay' | 'phonepe' | 'paytm'
  // | 'notification' (payment-app push), 'shared' (share-sheet), 'manual'.
  source?: string;
  // A category the user chose on the confirm screen — server stores it directly
  // (marked corrected) and skips the LLM classification for this transaction.
  category?: string;
}

export interface Classification {
  category: string;
  merchant: string;
  confidence: number;
  notes?: string;
}

export interface FewShot {
  raw_text: string;
  merchant: string | null;
  corrected_category: string;
}

export interface Env {
  DB: D1Database;
  API_TOKEN?: string;
  LLM_MODE?: string; // 'mock' | 'live'
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
}
