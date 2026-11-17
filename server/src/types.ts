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
  // Optional free-text note the user attached at add time.
  note?: string;
  // Optional tags the user attached at add time.
  tags?: string[];
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
  ATTACHMENTS: R2Bucket;
  API_TOKEN?: string;
  LLM_MODE?: string; // 'mock' | 'live'
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
  LLM_REPORT_MODEL?: string; // M7 — weekly digest model (defaults to a strong free-tier model)
  // TypeSafe Jev decision model (classification + check-in validation).
  TYPESAFE_API_KEY?: string;
  JEV_MODEL?: string; // default 'jev-latest'
  // Which engine categorises transactions: 'jev' (default — Jev, LLM only if Jev
  // errors) | 'hybrid' (also ask the LLM when Jev's confidence < 0.5) | 'llm'.
  CLASSIFIER?: string;
  // Workers AI — fallback LLM (text + vision) when the primary provider fails.
  AI?: Ai;
  AI_MODEL?: string;
}
