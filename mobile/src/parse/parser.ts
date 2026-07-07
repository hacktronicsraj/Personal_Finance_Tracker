import type { ParsedTxn } from './types';

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const OTP_RE = /\b(otp|one[\s-]?time\s?password|verification code|do not share|kyc|password)\b/i;
const MONEY_RE = /(?:rs|inr|₹)\.?\s?[\d,]+(?:\.\d{1,2})?/i;
const TXN_HINT_RE = /\b(debited|credited|spent|paid|withdrawn|purchase|txn|transaction|upi|debit|credit|sent|received)\b/i;

// Substrings found in Indian bank/UPI SMS sender IDs (e.g. "AX-IDBIBK", "VM-HDFCBK",
// "JD-SBIINB", "VK-PAYTMB"). Matched without word boundaries because the code is
// glued to a "BK"/"INB" suffix. A money token + a known bank sender = financial,
// even when the verb is one our body regex doesn't list.
const BANK_SENDER_RE =
  /(IDBI|HDFC|ICIC|SBI|AXIS|KOTAK|PNB|BOB|BARB|CANBK|CANARA|UBIN|UNION|YESB|IDFC|INDUS|FEDB|FEDERAL|RBL|BOI|CBI|CENTBK|UCO|IOB|KVB|SIB|DBS|HSBC|CITI|SCB|AUBL|AUBANK|BANDHN|EQUITAS|PAYTM|PYTM|GPAY|PHONPE|PHONEPE|AMZN|JUPITER|SLICE|CRED)/i;

/** True when the SMS sender ID looks like a bank / payments bank / UPI biller. */
export function isBankSender(sender?: string): boolean {
  if (!sender) return false;
  const s = sender.toUpperCase();
  if (/(BK|BNK|BANK|UPI)$/.test(s) || /-PB$/.test(s)) return true;
  return BANK_SENDER_RE.test(s);
}

/**
 * True when the message looks like a real bank/UPI transaction alert (and is NOT
 * an OTP / promotional / KYC message). Keeps non-financial SMS off the network.
 * Broadened: a money token from a known bank sender counts even without a hint verb.
 */
export function isFinancialSms(text: string, sender?: string): boolean {
  if (!text) return false;
  if (OTP_RE.test(text) && !/\b(debited|credited|spent|paid)\b/i.test(text)) return false;
  if (!MONEY_RE.test(text)) return false;
  return TXN_HINT_RE.test(text) || isBankSender(sender);
}

function toNumber(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // dd-MMM-yy | dd-MMM-yyyy | dd/MM/yy | dd-MM-yyyy
  let m = raw.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const mon = MONTHS[m[2].toLowerCase()];
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (mon !== undefined) return new Date(Date.UTC(year, mon, day)).toISOString();
  }
  m = raw.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const mon = Number(m[2]) - 1;
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, mon, day)).toISOString();
  }
  return undefined;
}

function cleanMerchant(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const cleaned = s
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
  return cleaned.length >= 2 ? cleaned : undefined;
}

/**
 * Parse an Indian bank/UPI SMS into a normalized transaction. Returns null if the
 * message is not a parseable transaction.
 *
 * Handles the IDBI/UPI shape where the account is *debited* while the payee's name
 * appears immediately before the word "credited":
 *   "IDBI Bank Acct XX417 debited for Rs 9000.00 on 02-Jul-26; Bal Rs 432.58
 *    Groww Invest Te credited. UPI:618359694589. To Block UPI send SMS ..."
 */
export function parseTransaction(rawText: string): ParsedTxn | null {
  if (!rawText) return null;

  // 1) Strip UPI-block / helpline boilerplate and trailing bank signature.
  let text = rawText
    .replace(/To Block UPI[\s\S]*$/i, ' ')
    .replace(/-\s*[A-Za-z ]+Bank\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2) Direction is governed by the ACCOUNT verb (first verb after the account no).
  const acctVerb = text.match(/A\/?c(?:ct)?\.?\s*(?:no\.?)?\s*[Xx*]+\s*\d+\s+(debited|credited)/i);
  let direction: 'debit' | 'credit' | undefined = acctVerb
    ? (acctVerb[1].toLowerCase() === 'debited' ? 'debit' : 'credit')
    : undefined;
  if (!direction) {
    if (/\b(debited|spent|withdrawn|paid|sent|purchase)\b/i.test(text)) direction = 'debit';
    else if (/\b(credited|received|deposited)\b/i.test(text)) direction = 'credit';
  }
  if (!direction) return null;

  // 3) Amount — prefer the amount tied to the debit/credit verb, else first money token.
  const amtNear = text.match(/(?:debited|credited|spent|paid|withdrawn|sent|received)\s*(?:for|of|by|with)?\s*(?:rs|inr|₹)\.?\s?([\d,]+(?:\.\d{1,2})?)/i);
  const amtAny = text.match(/(?:rs|inr|₹)\.?\s?([\d,]+(?:\.\d{1,2})?)/i);
  const amount = toNumber((amtNear ?? amtAny)?.[1]);
  if (amount === undefined) return null;

  // 4) Account tail, bank, ref, balance, date.
  const accountTail = text.match(/[Xx*]{2,}\s*(\d{3,6})/)?.[1];
  const bank = text.match(/\b([A-Za-z]+\s?Bank)\b/i)?.[1]?.replace(/\s+/g, ' ').trim();
  const refNo =
    text.match(/UPI[:\s]*([0-9]{6,})/i)?.[1] ??
    text.match(/(?:Ref|RRN|txn)\s*(?:no\.?|id)?[:\s]*([A-Za-z0-9]{6,})/i)?.[1];
  const balance = toNumber(text.match(/Bal(?:ance)?\.?\s*(?:Rs|INR|₹)?\.?\s?([\d,]+(?:\.\d{1,2})?)/i)?.[1]);
  const occurredAt = parseDate(text.match(/on\s+(\d{1,2}[-/\s][A-Za-z0-9]{2,3}[-/\s]\d{2,4})/i)?.[1]);

  // 5) Merchant / counterparty.
  let merchant: string | undefined;
  const vpa = text.match(/([A-Za-z0-9.\-_]{2,}@[A-Za-z]{2,})/)?.[1];
  if (direction === 'debit') {
    // Payee name sits right before "credited" (after the balance clause).
    merchant =
      cleanMerchant(text.match(/Bal(?:ance)?\.?\s*(?:Rs|INR|₹)?[\d,. ]+\s+([A-Za-z0-9 .&@'\-]+?)\s+credited/i)?.[1]) ??
      cleanMerchant(text.match(/\b(?:to|at|towards)\s+([A-Za-z0-9 .&@'\-]+?)(?:\s+on|\.|;|$)/i)?.[1]) ??
      cleanMerchant(vpa);
  } else {
    merchant =
      cleanMerchant(text.match(/\b(?:from|by)\s+([A-Za-z0-9 .&@'\-]+?)(?:\s+on|\.|;|$)/i)?.[1]) ??
      cleanMerchant(text.match(/([A-Za-z0-9 .&@'\-]+?)\s+debited/i)?.[1]) ??
      cleanMerchant(vpa);
  }

  return {
    amount,
    direction,
    currency: 'INR',
    bank,
    merchant,
    accountTail,
    refNo,
    balance,
    occurredAt,
  };
}

/** Stable key used to de-duplicate the same SMS across re-reads. */
export function dedupeKey(deviceId: string, p: ParsedTxn): string {
  return [deviceId, p.accountTail ?? '', p.amount, p.direction, p.occurredAt ?? '', p.refNo ?? ''].join('|');
}

/**
 * Parse the free-text a payment app hands to the Android share sheet
 * (PhonePe/Paytm typically share text like "Paid ₹250 to Blinkit"). Google Pay
 * shares an image instead — those go through backend vision extraction, not here.
 *
 * Returns a ParsedTxn (direction defaults to 'debit' — you share payments you made)
 * or null if no rupee amount is present.
 */
export function parsePayment(rawText: string): ParsedTxn | null {
  if (!rawText) return null;
  const text = rawText.replace(/\s+/g, ' ').trim();

  const amount = toNumber(text.match(/(?:rs|inr|₹)\.?\s?([\d,]+(?:\.\d{1,2})?)/i)?.[1]);
  if (amount === undefined) return null;

  const direction: 'debit' | 'credit' = /\b(received|credited|added\s+to)\b/i.test(text) ? 'credit' : 'debit';

  const merchant =
    cleanMerchant(text.match(/\b(?:paid to|sent to|to|at|towards)\s+([A-Za-z0-9 .&@'\-]+?)(?:\s+(?:on|for|via|using|is|success\w*|ref|txn|utr|now)\b|[.,;!]|$)/i)?.[1]) ??
    cleanMerchant(text.match(/\b(?:from|by)\s+([A-Za-z0-9 .&@'\-]+?)(?:\s+(?:on|for|via|success\w*)\b|[.,;!]|$)/i)?.[1]) ??
    cleanMerchant(text.match(/([A-Za-z0-9.\-_]{2,}@[A-Za-z]{2,})/)?.[1]);

  const occurredAt = parseDate(text.match(/on\s+(\d{1,2}[-/\s][A-Za-z0-9]{2,3}[-/\s]\d{2,4})/i)?.[1]);

  return { amount, direction, currency: 'INR', merchant, occurredAt };
}
