export interface ParsedTxn {
  amount: number;
  direction: 'debit' | 'credit';
  currency: string;
  bank?: string;
  merchant?: string;
  accountTail?: string;
  refNo?: string;
  balance?: number;
  occurredAt?: string; // ISO-8601 (date at UTC midnight)
}
