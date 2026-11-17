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

// A biller's "your bill is due" reminder, which carries an amount and a date but
// means no money has moved. These are rejected outright: unlike the softer
// EXCLUDE_RE below, no transaction verb elsewhere in the message can rescue them,
// because reminders routinely end with "ignore if already paid" (see
// HYPOTHETICAL_RE) or offer a "pay now" link.
const DUE_NOTICE_RE =
  /\b(?:bill|payment|amount|emi|premium|due amount|min(?:imum)? due|total due)\b[^.]{0,60}?\bis\s+due\b|\bdue\s+for\s+payment\b|\bis\s+due\s+(?:on|by)\b|\bplease\s+pay\s+(?:by|before)\b/i;

// Clauses that name a payment verb hypothetically rather than reporting one.
// "Please ignore if already paid" was letting every Airtel bill reminder through
// the EXCLUDE_RE gate, booking the due amount as a completed debit.
const HYPOTHETICAL_RE =
  /\b(?:please\s+)?ignore\s+(?:this\s+)?if\s+(?:already\s+)?paid\b|\bif\s+(?:you\s+have\s+)?(?:already\s+)?(?:not\s+)?paid\b|\bkindly\s+ignore\b/gi;

/**
 * True when the message looks like a real bank/UPI transaction alert (and is NOT
 * an OTP / promotional / KYC / bill-reminder message). Keeps non-financial SMS off
 * the network. Broadened: a money token from a known bank sender counts even
 * without a hint verb.
 */
export function isFinancialSms(text: string, sender?: string): boolean {
  if (!text) return false;
  if (OTP_RE.test(text) && !/\b(debited|credited|spent|paid)\b/i.test(text)) return false;

  // A due notice never represents money that moved — reject before anything else.
  if (DUE_NOTICE_RE.test(text)) return false;

  // Exclude mandate/autopay setup, payment reminders, failed/reversed txns,
  // promotional offers, and EMI due reminders — unless the message also contains
  // an actual transaction verb proving money already moved.
  const EXCLUDE_RE = /\b(mandate|auto[\s-]?pay|autopay|si registered|standing instruction|reminder|due date|due on|payment due|pay by|last date|failed|declined|unsuccessful|reversed|could not|cashback offer|get ₹|earn ₹|win ₹|flat ₹|emi due|emi of|instalment|set up|register|activate|e-?nach|nach debit|renewal|upcoming|will be debited|will be charged|scheduled|is due)\b/i;
  const ACTUAL_TXN_RE = /\b(debited|credited|spent|paid|withdrawn)\b/i;
  // Test the verb against text with hypothetical clauses removed, so "ignore if
  // already paid" can't stand in as proof the payment happened.
  const evidence = text.replace(HYPOTHETICAL_RE, ' ');
  if (EXCLUDE_RE.test(text) && !ACTUAL_TXN_RE.test(evidence)) return false;

  if (!MONEY_RE.test(text)) return false;
  return TXN_HINT_RE.test(text) || isBankSender(sender);
}

function toNumber(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function parseDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  let day: number | undefined;
  let mon: number | undefined;
  let year: number | undefined;

  // "07 Jul", "02-Jul-26", "02 July 2026". Year is OPTIONAL — and a trailing clock
  // time like "07:44" must NOT be mistaken for the year (that's the "2007" bug),
  // so the year token is rejected when immediately followed by ':' or more digits.
  let m = text.match(/\b(\d{1,2})[-\s]([A-Za-z]{3,9})(?:[-\s](\d{4}|\d{2})(?!\s*:|\d))?/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    day = Number(m[1]);
    mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (m[3]) year = Number(m[3]);
  } else {
    // "dd/MM/yy" | "dd-MM-yyyy"
    m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    if (m) {
      day = Number(m[1]);
      mon = Number(m[2]) - 1;
      year = Number(m[3]);
    }
  }
  if (day === undefined || mon === undefined || mon < 0 || mon > 11 || day < 1 || day > 31) {
    return undefined;
  }

  const now = new Date();
  if (year === undefined) year = now.getFullYear(); // no year in the SMS → assume this year (local time)
  else if (year < 100) year += 2000;

  // The SMS carries an IST calendar date with no time. Anchor it to midnight UTC
  // (deterministic, independent of the runtime's timezone): 00:00Z renders as
  // 05:30 the same day in IST, so the displayed calendar date never drifts.
  const d = new Date(Date.UTC(year, mon, day));
  // Plausibility guard: a bank alert is never years old or in the future. Reject
  // absurd parses (>2 days ahead / >2 years back) so a mis-read date becomes
  // "unknown" and the txn falls back to its capture time downstream.
  const diff = d.getTime() - now.getTime();
  if (diff > 2 * 86400000 || diff < -730 * 86400000) return undefined;
  return d.toISOString();
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

  // 1) Strip UPI-block / dispute / helpline boilerplate and trailing bank signature
  //    so none of it gets mistaken for the payee (e.g. "To dispute call ... SFBL").
  let text = rawText
    .replace(/To Block UPI[\s\S]*$/i, ' ')
    .replace(/To dispute[\s\S]*$/i, ' ')
    .replace(/-\s*[A-Za-z ]+(?:Bank|SFBL?|Ltd)\.?\s*$/i, ' ')
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
  const occurredAt = parseDate(text);

  // 5) Merchant / counterparty.
  let merchant: string | undefined;
  const vpa = text.match(/([A-Za-z0-9.\-_]{2,}@[A-Za-z]{2,})/)?.[1];
  if (direction === 'debit') {
    // Payee name sits right before "credited" (after the balance clause).
    merchant =
      cleanMerchant(text.match(/Bal(?:ance)?\.?\s*(?:Rs|INR|₹)?[\d,. ]+\s+([A-Za-z0-9 .&@'\-]+?)\s+credited/i)?.[1]) ??
      cleanMerchant(text.match(/\b(?:to|at|towards)\s+([A-Za-z0-9 .&@'\-]+?)(?:\s+on|\.|;|$)/i)?.[1]) ??
      cleanMerchant(vpa) ??
      // SuperCard (Utkarsh SFBL) alerts carry no payee — just "for UPI - <ref>".
      // Label them so they read as a real spend instead of "Unknown".
      (/\bsuper\s?card\b/i.test(rawText) ? 'SuperCard Payment' : undefined);
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

  const occurredAt = parseDate(text);

  return { amount, direction, currency: 'INR', merchant, occurredAt };
}
