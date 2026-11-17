import { isIgnoredPayee } from './classify';
import { dayDiff, istDayOfIso } from './ist';
import { llmEnabled, llmJson, type ChatMessage } from './llm';
import type { Env } from './types';

/**
 * Bank-statement reconciliation.
 *
 * The phone extracts the PDF's text (PDFBox on-device, so a password-protected
 * statement is unlocked on the phone and only its text is uploaded), the Worker
 * turns that text into rows (a deterministic line parser whose running balances
 * must reconcile, else the LLM), and `reconcile()` lines the rows up against the
 * ledger:
 *   match  — statement debit ↔ existing transaction (by UPI ref, else amount+date)
 *   add    — a statement debit the app never captured
 *   remove — an app transaction in the statement period the bank has no record of
 * Nothing changes until the user approves each proposal.
 */

export interface StatementRow {
  idx: number;
  date: string; // IST YYYY-MM-DD
  description: string;
  merchant: string | null;
  amount: number;
  type: 'debit' | 'credit';
  balance: number | null;
  ref: string | null;
}

export interface ParsedStatement {
  bank: string | null;
  accountTail: string | null;
  periodStart: string;
  periodEnd: string;
  rows: StatementRow[];
  parser: 'llm' | 'heuristic';
  balanceCheck: { checked: number; ok: number };
}

/* ─────────────────────────────── Primitive parsers ─────────────────────────────── */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Indian statement dates → YYYY-MM-DD. Day-first (DD/MM/YYYY), never US order. */
export function parseStmtDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})\b/);
  if (m) return valid(fullYear(+m[3]), +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[\/\-. ]?([A-Za-z]{3,4})[a-z]*[\/\-. ,]*(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(fullYear(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

/** "1,23,456.78" / "(1,234.50)" / "1234.5 Dr" → 123456.78 etc. */
export function parseMoney(s: unknown): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? Math.abs(s) : null;
  if (typeof s !== 'string') return null;
  const n = Number(s.replace(/[₹,\s]|INR|Rs\.?|Dr|Cr|\(|\)/gi, ''));
  return Number.isFinite(n) && s.trim() !== '' ? Math.abs(n) : null;
}

const MONEY_RE = /(?<![\d.])\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?(?![\d])|(?<![\d.,])\d+\.\d{2}(?![\d])/g;
const DATE_CORE = '\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[\\/\\-. ]\\d{1,2}[\\/\\-. ]\\d{2,4}|\\d{1,2}[\\/\\-. ]?[A-Za-z]{3,4}[\\/\\-. ,]*\\d{2,4}';
// A transaction line may begin with a serial number (S.No column) before the date.
const ROW_DATE_RE = new RegExp(`^\\s*(?:\\d{1,4}\\s+)?(${DATE_CORE})`);
const LEAD_DATE_RE = new RegExp(`^\\s*(${DATE_CORE})`);
// A timestamp that follows the transaction date, e.g. "19/09/2026 17:07:31".
const TIME_RE = /^\s*\d{1,2}:\d{2}(?::\d{2})?/;

/** UPI RRN (12 digits) or other long numeric reference inside a description. */
export function extractRef(desc: string): string | null {
  const m = desc.match(/(?<!\d)(\d{12})(?!\d)/) ?? desc.match(/(?<!\d)(\d{10,16})(?!\d)/);
  return m ? m[1] : null;
}

/** Best-effort payee from a statement narration, e.g. "UPI/DR/612345678901/ZOMATO/YESB/…" → "ZOMATO". */
export function merchantFromDescription(desc: string): string | null {
  const parts = desc.split(/[\/|]/).map((p) => p.trim()).filter(Boolean);
  const refIdx = parts.findIndex((p) => /^\d{10,16}$/.test(p));
  if (refIdx >= 0) {
    const next = parts.slice(refIdx + 1).find((p) => /[A-Za-z]{2,}/.test(p) && !/^(DR|CR|UPI|YESB|ICIC|HDFC|SBIN|UTIB|PYTM|IBKL|AXIS|KKBK)$/i.test(p));
    if (next) return next.replace(/@.*$/, '').trim() || null;
  }
  const cleaned = desc
    .replace(/\b(UPI|IMPS|NEFT|RTGS|POS|ATM|ECS|NACH|ACH|DR|CR|TO|TRF|TRANSFER|BY|INB|MB|PAYMENT|P2A|P2M)\b/gi, ' ')
    .replace(/[\d\/\-_:*#@.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 40) : null;
}

interface RawRow {
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  hint: 'debit' | 'credit' | null; // explicit Dr/Cr marker on the line, if any
}

/**
 * Deterministic parser. Handles the common Indian layouts: a line optionally
 * starts with a serial number, then the transaction date (with an optional
 * timestamp and value-date column), a description, and one or two money columns
 * ending in the running balance.
 *
 * Direction is decided from the running-balance movement (works whether or not
 * the line carries a Dr/Cr marker, and whichever way the amount column is laid
 * out) after the rows are put in chronological order — statements come both
 * newest-first and oldest-first. An explicit Dr/Cr marker is the fallback.
 */
// Page headers/footers and account-detail lines that are never part of a
// transaction — they also end a wrapped row's continuation.
const NOISE_RE =
  /toll-?free|statement downloaded|page \d+\s+of|^s\.?\s?no\b|withdrawals?\s+deposits?|customer details|computer[- ]generated|grievance|www\.|@\w+\.(?:com|in)|ifsc|micr|account (?:no|status|holder|opening|branch|type)|nominee|branch (?:details|code|email)|transaction date from|cheque no|currency\b|ckyc/i;

export function heuristicParse(text: string): StatementRow[] {
  const raws: RawRow[] = [];
  let openingBalance: number | null = null;

  // 1) Group each transaction into one logical line. A statement row can wrap: a
  //    long payee name pushes the running balance (and more of the description)
  //    onto the following physical line(s). Continuation lines have no leading
  //    date, so they're folded back into the row they belong to.
  const groups: string[] = [];
  let cur: string | null = null;
  const flush = () => {
    if (cur) groups.push(cur);
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (/opening balance|balance b\/?f|brought forward/i.test(line)) {
      const nums = line.match(MONEY_RE);
      if (nums?.length && openingBalance === null) openingBalance = parseMoney(nums[nums.length - 1]);
      flush();
      continue;
    }
    if (/closing balance|balance c\/?f|carried forward/i.test(line) || NOISE_RE.test(line)) {
      flush();
      continue;
    }
    const dm = line.match(ROW_DATE_RE);
    if (dm && parseStmtDate(dm[1])) {
      flush();
      cur = line;
    } else if (cur) {
      cur += ' ' + line; // continuation of the current row
    }
  }
  flush();

  // 2) Parse each grouped row.
  for (const group of groups) {
    const dm = group.match(ROW_DATE_RE)!;
    const date = parseStmtDate(dm[1]);
    if (!date) continue;
    let rest = group.slice(dm[0].length).replace(TIME_RE, ''); // drop the txn timestamp
    const vd = rest.match(LEAD_DATE_RE); // value-date column
    if (vd && parseStmtDate(vd[1])) rest = rest.slice(vd[0].length).replace(TIME_RE, '');

    const nums = rest.match(MONEY_RE);
    if (!nums?.length) continue;
    const firstNumAt = rest.search(MONEY_RE);
    const description = rest.slice(0, firstNumAt).trim();
    const amount = parseMoney(nums.length >= 2 ? nums[nums.length - 2] : nums[0]);
    const balance = nums.length >= 2 ? parseMoney(nums[nums.length - 1]) : null;
    if (!amount) continue;

    let hint: 'debit' | 'credit' | null = null;
    if (/\bDr\b|withdraw|debit/i.test(rest) || /\/DR\//i.test(description)) hint = 'debit';
    else if (/\bCr\b|deposit|credit/i.test(rest) || /\/CR\//i.test(description)) hint = 'credit';

    raws.push({ date, description, amount, balance, hint });
  }
  if (!raws.length) return [];

  // Put rows in chronological order (oldest first) so a running-balance delta
  // names the direction. Statements arrive both newest-first and oldest-first.
  const ascending = raws[0].date <= raws[raws.length - 1].date;
  const chrono = ascending ? raws : [...raws].reverse();

  let prev: number | null = openingBalance;
  const rows: StatementRow[] = chrono.map((r, idx) => {
    let type: 'debit' | 'credit' | null = null;
    if (prev != null && r.balance != null) {
      if (Math.abs(prev - r.amount - r.balance) < 0.011) type = 'debit';
      else if (Math.abs(prev + r.amount - r.balance) < 0.011) type = 'credit';
    }
    if (!type) type = r.hint ?? 'debit';
    if (r.balance != null) prev = r.balance;
    return {
      idx,
      date: r.date,
      description: r.description,
      merchant: merchantFromDescription(r.description),
      amount: r.amount,
      type,
      balance: r.balance,
      ref: extractRef(r.description),
    };
  });
  return rows;
}

/** Coerce model output into clean rows; drops anything without a date + amount. */
export function normalizeRows(raw: any[]): StatementRow[] {
  const out: StatementRow[] = [];
  for (const r of raw ?? []) {
    const date = typeof r?.date === 'string' ? parseStmtDate(r.date) : null;
    const amount = parseMoney(r?.amount);
    const type = String(r?.type ?? '').toLowerCase().startsWith('c') ? 'credit' : String(r?.type ?? '').toLowerCase().startsWith('d') ? 'debit' : null;
    if (!date || !amount || !type) continue;
    const description = String(r?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const refRaw = r?.ref != null ? String(r.ref).replace(/\D/g, '') : '';
    out.push({
      idx: out.length,
      date,
      description,
      merchant: r?.merchant ? String(r.merchant).trim().slice(0, 80) : merchantFromDescription(description),
      amount: Math.round(amount * 100) / 100,
      type,
      balance: parseMoney(r?.balance),
      ref: refRaw.length >= 6 ? refRaw : extractRef(description),
    });
  }
  return out;
}

/** How many consecutive rows satisfy prev_balance ∓ amount = balance (extraction sanity). */
export function balanceCheck(rows: StatementRow[]): { checked: number; ok: number } {
  let checked = 0;
  let ok = 0;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1].balance;
    const b = rows[i].balance;
    if (p == null || b == null) continue;
    checked++;
    const expected = rows[i].type === 'debit' ? p - rows[i].amount : p + rows[i].amount;
    if (Math.abs(expected - b) < 0.011) ok++;
  }
  return { checked, ok };
}

export function accountTailOf(acct: string | null | undefined): string | null {
  const d = String(acct ?? '').replace(/\D/g, '');
  return d.length >= 3 ? d.slice(-4) : null;
}

/* ─────────────────────────────── LLM extraction ─────────────────────────────── */

const EXTRACT_PROMPT = [
  'You extract transactions from an Indian bank account statement.',
  'Return ONLY minified JSON:',
  '{"bank":str|null,"account_number":str|null,"period_start":"YYYY-MM-DD"|null,"period_end":"YYYY-MM-DD"|null,',
  ' "transactions":[{"date":"YYYY-MM-DD","description":str,"merchant":str|null,"amount":number,"type":"debit"|"credit","balance":number|null,"ref":str|null}]}',
  'Rules:',
  '- Include EVERY transaction row, in statement order. Skip opening/closing balance lines, page totals and headers.',
  '- Dates in Indian statements are day-first (DD/MM/YYYY or DD-Mon-YYYY). Use the transaction date, not the value date.',
  '- amount is positive. type = "debit" for withdrawals/Dr/money out, "credit" for deposits/Cr/money in.',
  '- merchant = the clean payee/payer name from the narration (e.g. "UPI/DR/612345678901/ZOMATO/YESB/…" → "Zomato"; a person\'s name stays a name).',
  '- ref = the UPI reference / RRN / transaction id digits if present, else null.',
  '- If a field is not in this text, use null. Never invent rows.',
].join('\n');

interface LlmStatement {
  bank?: string | null;
  account_number?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  transactions?: any[];
}

/** Split page texts into model-sized chunks without cutting a page. */
export function chunkPages(pages: string[], maxChars = 14000): string[] {
  const chunks: string[] = [];
  let cur = '';
  pages.forEach((p, i) => {
    const block = `\n--- page ${i + 1} ---\n${p}`;
    if (cur && cur.length + block.length > maxChars) {
      chunks.push(cur);
      cur = '';
    }
    cur += block;
  });
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

async function llmExtract(env: Env, input: { pages?: string[]; images?: string[] }): Promise<LlmStatement> {
  const calls: Promise<LlmStatement>[] = [];
  for (const chunk of chunkPages(input.pages ?? [])) {
    calls.push(
      llmJson<LlmStatement>(env, [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: chunk },
      ], { retries: 3, timeoutMs: 60000 }),
    );
  }
  // Scanned statements (no text layer): page images, three per call.
  const imgs = input.images ?? [];
  for (let i = 0; i < imgs.length; i += 3) {
    const content: ChatMessage['content'] = [
      { type: 'text', text: 'Statement page images follow.' },
      ...imgs.slice(i, i + 3).map((b64) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${b64}` } })),
    ];
    calls.push(llmJson<LlmStatement>(env, [{ role: 'system', content: EXTRACT_PROMPT }, { role: 'user', content }], { retries: 3, timeoutMs: 60000 }));
  }
  if (!calls.length) throw new Error('empty statement');
  const parts = await Promise.all(calls);
  const first = parts.find((p) => p.account_number || p.bank) ?? parts[0];
  return {
    bank: first.bank ?? null,
    account_number: first.account_number ?? null,
    period_start: parts.map((p) => p.period_start).find(Boolean) ?? null,
    period_end: parts.map((p) => p.period_end).find(Boolean) ?? null,
    transactions: parts.flatMap((p) => p.transactions ?? []),
  };
}

const BANK_RE = /\b(IDBI|HDFC|ICICI|SBI|State Bank of India|Axis|Kotak|Yes Bank|IndusInd|Canara|Union Bank|Bank of Baroda|Federal|IDFC FIRST|AU Small Finance|Utkarsh)\b/i;

/** Canonical display name: acronyms upper-cased, and " Bank" appended once. */
function normalizeBankName(raw: string): string {
  const acronym = /^(IDBI|HDFC|ICICI|SBI|IDFC|AU)$/i.test(raw) ? raw.toUpperCase() : raw;
  return /bank/i.test(acronym) ? acronym : `${acronym} Bank`;
}

/** Header facts a regex can find without any model: bank, account, period. */
export function statementMeta(text: string): { bank: string | null; accountTail: string | null; periodStart: string | null; periodEnd: string | null } {
  const bank = text.match(BANK_RE)?.[1] ?? null;
  const acct = text.match(/(?:a\/?c|account)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([X\d*]{6,20})/i)?.[1];
  const period = text.match(
    /(?:period|from)\s*[:\-]?\s*(\d{1,2}[\/\-.][\dA-Za-z]{1,3}[\/\-.]\d{2,4})\s*(?:to|-|till)\s*(\d{1,2}[\/\-.][\dA-Za-z]{1,3}[\/\-.]\d{2,4})/i,
  );
  return {
    bank: bank ? normalizeBankName(bank) : null,
    accountTail: accountTailOf(acct),
    periodStart: period ? parseStmtDate(period[1]) : null,
    periodEnd: period ? parseStmtDate(period[2]) : null,
  };
}

/** A deterministic parse we can trust: rows found and ≥90% of running balances reconcile. */
function trustworthy(rows: StatementRow[]): boolean {
  const b = balanceCheck(rows);
  return rows.length > 0 && b.checked >= Math.min(2, rows.length - 1) && b.ok >= 0.9 * b.checked;
}

/**
 * Text (and/or page images) → structured statement.
 *   1. the deterministic line parser, when its running balances reconcile — exact,
 *      free, and immune to a model shuffling narrations between rows;
 *   2. otherwise the LLM (text chunks, or page images for scanned PDFs);
 *   3. otherwise whatever the line parser found.
 */
export async function parseStatement(env: Env, input: { pages?: string[]; images?: string[] }): Promise<ParsedStatement> {
  const text = (input.pages ?? []).join('\n');
  const meta = statementMeta(text);
  let rows = text.trim() ? heuristicParse(text) : [];
  let parser: ParsedStatement['parser'] = 'heuristic';
  let llmMeta: LlmStatement = {};

  if (!trustworthy(rows) && llmEnabled(env)) {
    try {
      llmMeta = await llmExtract(env, input);
      const llmRows = normalizeRows(llmMeta.transactions ?? []);
      if (llmRows.length) {
        rows = llmRows;
        parser = 'llm';
      }
    } catch {
      /* keep the heuristic rows, if any */
    }
  }
  if (!rows.length) throw new Error('No transactions could be read from this statement.');

  const dates = rows.map((r) => r.date).sort();
  const pick = (a: string | null | undefined) => (a && parseStmtDate(a)) || null;
  const periodStart = meta.periodStart ?? pick(llmMeta.period_start) ?? dates[0];
  const periodEnd = meta.periodEnd ?? pick(llmMeta.period_end) ?? dates[dates.length - 1];
  return {
    bank: meta.bank ?? llmMeta.bank ?? null,
    accountTail: meta.accountTail ?? accountTailOf(llmMeta.account_number),
    periodStart: periodStart <= dates[0] ? periodStart : dates[0],
    periodEnd: periodEnd >= dates[dates.length - 1] ? periodEnd : dates[dates.length - 1],
    rows,
    parser,
    balanceCheck: balanceCheck(rows),
  };
}

/* ─────────────────────────────── Reconciliation ─────────────────────────────── */

export interface LedgerTxn {
  id: string;
  amount: number;
  direction: string;
  occurred_at: string | null;
  created_at: string;
  merchant: string | null;
  raw_text: string | null;
  ref_no: string | null;
  source: string;
  account_tail: string | null;
  category: string;
}

export interface Reconciliation {
  matches: { row: StatementRow; txn: LedgerTxn; via: 'ref' | 'amount-date' }[];
  adds: StatementRow[];
  removes: { txn: LedgerTxn; suggested: 'approve' | 'deny'; note: string | null }[];
  creditsIgnored: number;
}

// A spend ON a credit card ("your SuperCard 4003 debited…", "USD 5.80 was spent on
// your SuperCard at …") lives on the card bill, not the bank statement. The card
// *settlement* ("Acct XX417 debited … SuperCa credited") is a bank debit and stays.
const CARD_SPEND_RE =
  /\byour\s+(?:\w+\s+)?(?:super\s?ca(?:rd)?|credit\s?card|card)\s*(?:no\.?\s*)?[x*]*\d*\s+(?:has\s+been\s+)?(?:debited|spent|used)\b|\b(?:spent|used|debited)\b[^.]{0,40}\bon\s+your\s+(?:\w+\s+)?(?:super\s?ca(?:rd)?|credit\s?card|card)\b/i;

const txnDay = (t: LedgerTxn) => istDayOfIso(t.occurred_at ?? t.created_at);

function tailsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return true; // unknown → don't exclude
  const x = a.replace(/\D/g, '');
  const y = b.replace(/\D/g, '');
  if (!x || !y) return true;
  return x.endsWith(y.slice(-3)) || y.endsWith(x.slice(-3));
}

/** Could this ledger transaction appear on this bank account's statement at all? */
export function onThisAccount(t: LedgerTxn, accountTail: string | null): boolean {
  if (t.direction !== 'debit') return false;
  if (CARD_SPEND_RE.test(t.raw_text ?? '')) return false; // a credit-card spend is on the card bill, not here
  return tailsMatch(t.account_tail, accountTail);
}

function nameSimilarity(a: string | null, b: string | null): number {
  const A = new Set(String(a ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 3));
  const B = new Set(String(b ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 3));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if ([...B].some((v) => v.startsWith(w) || w.startsWith(v))) n++;
  return n / Math.min(A.size, B.size);
}

/**
 * Pure matcher. One-to-one: each statement debit claims at most one ledger row.
 *  1. exact reference (UPI RRN in the SMS text / ref_no) with the same amount
 *  2. same amount (to the paisa) within ±2 days; nearest day, then closest name
 * Leftover statement debits become `adds`; leftover ledger debits dated inside
 * the statement period (and on this account) become `removes`.
 */
export function reconcile(stmt: Pick<ParsedStatement, 'rows' | 'periodStart' | 'periodEnd' | 'accountTail'>, ledger: LedgerTxn[]): Reconciliation {
  const debits = stmt.rows.filter((r) => r.type === 'debit');
  const pool = ledger.filter((t) => t.direction === 'debit');
  const used = new Set<string>();
  const matched = new Set<number>();
  const matches: Reconciliation['matches'] = [];

  for (const row of debits) {
    if (!row.ref) continue;
    const t = pool.find(
      (x) => !used.has(x.id) && Math.abs(x.amount - row.amount) < 0.011 &&
        (x.ref_no?.replace(/\D/g, '') === row.ref || (x.raw_text ?? '').includes(row.ref!)),
    );
    if (t) {
      used.add(t.id);
      matched.add(row.idx);
      matches.push({ row, txn: t, via: 'ref' });
    }
  }

  const byDate = [...debits].sort((a, b) => a.date.localeCompare(b.date) || a.idx - b.idx);
  for (const row of byDate) {
    if (matched.has(row.idx)) continue;
    let best: LedgerTxn | null = null;
    let bestScore = Infinity;
    for (const t of pool) {
      if (used.has(t.id) || Math.abs(t.amount - row.amount) >= 0.011) continue;
      const dd = Math.abs(dayDiff(row.date, txnDay(t)));
      if (dd > 2) continue;
      const score = dd * 10 - nameSimilarity(row.merchant ?? row.description, t.merchant) * 5;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      used.add(best.id);
      matched.add(row.idx);
      matches.push({ row, txn: best, via: 'amount-date' });
    }
  }

  // Never propose adding an ignored payee (investment platforms like Groww).
  const adds = debits.filter((r) => !matched.has(r.idx) && !isIgnoredPayee(r.merchant, r.description));
  const removes: Reconciliation['removes'] = [];
  for (const t of pool) {
    if (used.has(t.id)) continue;
    const d = txnDay(t);
    if (d < stmt.periodStart || d > stmt.periodEnd) continue;
    if (!onThisAccount(t, stmt.accountTail)) continue;
    if (t.source === 'manual') {
      removes.push({ txn: t, suggested: 'deny', note: 'Added manually — could be a cash payment, which never shows on a bank statement.' });
    } else if (d === stmt.periodEnd) {
      removes.push({ txn: t, suggested: 'deny', note: 'On the statement’s last day — it may have been cut off before this posted.' });
    } else {
      removes.push({ txn: t, suggested: 'approve', note: null });
    }
  }
  return { matches, adds, removes, creditsIgnored: stmt.rows.length - debits.length };
}

/** Stable dedupe key for a transaction created from a statement row. */
export function statementDedupeKey(accountTail: string | null, row: Pick<StatementRow, 'date' | 'amount' | 'ref' | 'description'>): string {
  const tag = row.ref ?? row.description.replace(/\W+/g, '').slice(0, 24);
  return `stmt|${accountTail ?? ''}|${row.date}|${row.amount}|${tag}`;
}
