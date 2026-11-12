export interface Env {
  DB: D1Database;
  AI?: Ai;
  API_TOKEN?: string;
  /** Password for the browser upload page (POST /upload/bulk). Unset = disabled. */
  UPLOAD_PASSWORD?: string;
  LLM_MODE?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
  AI_MODEL?: string;
}

export type Direction = 'debit' | 'credit';

/** The standard category taxonomy (matches the `categories` seed by name). */
export type Category =
  | 'Food & Dining'
  | 'Groceries'
  | 'Transport'
  | 'Shopping'
  | 'Bills & Utilities'
  | 'Entertainment'
  | 'Health'
  | 'Transfers'
  | 'Card Payment'
  | 'Income'
  | 'Other';

/** A parsed payment, before classification/storage. */
export interface ParsedTxn {
  amount: number;
  direction: Direction;
  currency?: string;
  bank?: string | null;
  merchant?: string | null;
  accountTail?: string | null;
  refNo?: string | null;
  balance?: number | null;
  occurredAt?: string | null;
  rawText?: string;
}

export interface Classification {
  category: Category;
  merchant: string;
  confidence: number;
  notes: string;
}

/** A stored transaction row (shape returned to the client). */
export interface TxnRow {
  id: string;
  device_id: string | null;
  dedupe_key: string | null;
  raw_text: string;
  amount: number;
  direction: Direction;
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
  tags: string | null;
  merchant_norm: string | null;
  source: string;
  corrected: number;
  created_at: string;
  updated_at: string;
}
