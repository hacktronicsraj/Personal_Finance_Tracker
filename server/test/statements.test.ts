import { describe, expect, it } from 'vitest';
import {
  accountTailOf,
  balanceCheck,
  chunkPages,
  extractRef,
  heuristicParse,
  merchantFromDescription,
  normalizeRows,
  onThisAccount,
  parseMoney,
  parseStmtDate,
  reconcile,
  statementDedupeKey,
  type LedgerTxn,
  type StatementRow,
} from '../src/statements';

describe('parseStmtDate', () => {
  it('reads Indian day-first formats', () => {
    expect(parseStmtDate('05/09/2026')).toBe('2026-09-05');
    expect(parseStmtDate('05-09-26')).toBe('2026-09-05');
    expect(parseStmtDate('5-Sep-2026')).toBe('2026-09-05');
    expect(parseStmtDate('05 Sep 2026')).toBe('2026-09-05');
    expect(parseStmtDate('2026-09-05')).toBe('2026-09-05');
    expect(parseStmtDate('05.09.2026')).toBe('2026-09-05');
  });
  it('rejects impossible dates and non-dates', () => {
    expect(parseStmtDate('31/02/2026')).toBeNull();
    expect(parseStmtDate('Opening balance')).toBeNull();
    expect(parseStmtDate('13/13/2026')).toBeNull();
  });
});

describe('parseMoney', () => {
  it('handles lakh grouping, currency marks and Dr/Cr suffixes', () => {
    expect(parseMoney('1,23,456.78')).toBe(123456.78);
    expect(parseMoney('₹ 1,250.00 Dr')).toBe(1250);
    expect(parseMoney('(499.00)')).toBe(499);
    expect(parseMoney(42)).toBe(42);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('narration helpers', () => {
  it('pulls the UPI reference and payee out of a narration', () => {
    const d = 'UPI/DR/612345678901/ZOMATO/YESB/zomato@ybl/Payment';
    expect(extractRef(d)).toBe('612345678901');
    expect(merchantFromDescription(d)).toBe('ZOMATO');
  });
  it('falls back to a cleaned narration without a ref', () => {
    expect(merchantFromDescription('POS 4411 DMART HYDERABAD')).toBe('DMART HYDERABAD');
  });
  it('account tail keeps the last four digits', () => {
    expect(accountTailOf('XXXXXXXX0417')).toBe('0417');
    expect(accountTailOf(null)).toBeNull();
  });
});

const SAMPLE = `IDBI BANK  Statement of Account
Account No: XXXXXXXX0417   Period: 01/09/2026 to 07/09/2026
Date       Value Dt   Description                                    Debit      Credit     Balance
01/09/2026 Opening Balance                                                                 1,000.00
01/09/2026 01/09/2026 UPI/DR/612345678901/ZOMATO/YESB/zomato@ybl   254.00                  746.00
02/09/2026 02/09/2026 UPI/CR/612345678902/AMMA/SBIN/amma@okaxis                2,000.00   2,746.00
03/09/2026 03/09/2026 UPI/DR/612345678903/HYDERABAD METRO/ICIC     47.00                   2,699.00
05/09/2026 05/09/2026 SMS CHARGES QTR                                38.94                   2,660.06
`;

describe('heuristicParse', () => {
  const rows = heuristicParse(SAMPLE);
  it('reads every transaction line and skips the opening balance', () => {
    expect(rows).toHaveLength(4);
  });
  it('derives direction from the running balance', () => {
    expect(rows.map((r) => r.type)).toEqual(['debit', 'credit', 'debit', 'debit']);
    expect(rows[0]).toMatchObject({ date: '2026-09-01', amount: 254, balance: 746, ref: '612345678901', merchant: 'ZOMATO' });
    expect(rows[3]).toMatchObject({ date: '2026-09-05', amount: 38.94 });
  });
  it('passes its own balance check', () => {
    expect(balanceCheck(rows)).toEqual({ checked: 3, ok: 3 });
  });
});

describe('normalizeRows', () => {
  it('coerces model output and drops junk', () => {
    const rows = normalizeRows([
      { date: '01/09/2026', description: 'UPI/DR/612345678901/ZOMATO', amount: '254.00', type: 'DEBIT', balance: '746', ref: 'UPI 612345678901' },
      { date: 'garbage', amount: 5, type: 'debit' },
      { date: '2026-09-02', amount: 0, type: 'debit' },
      { date: '2026-09-02', amount: 10, type: 'transfer' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2026-09-01', amount: 254, type: 'debit', balance: 746, ref: '612345678901' });
  });
});

describe('chunkPages', () => {
  it('never splits a page and respects the budget', () => {
    const chunks = chunkPages(['a'.repeat(6000), 'b'.repeat(6000), 'c'.repeat(6000)], 14000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('page 1');
    expect(chunks[0]).toContain('page 2');
    expect(chunks[1]).toContain('page 3');
  });
});

const row = (idx: number, date: string, amount: number, extra: Partial<StatementRow> = {}): StatementRow => ({
  idx, date, amount, type: 'debit', description: `row ${idx}`, merchant: null, balance: null, ref: null, ...extra,
});
const txn = (id: string, day: string, amount: number, extra: Partial<LedgerTxn> = {}): LedgerTxn => ({
  id, amount, direction: 'debit', occurred_at: `${day}T06:30:00.000Z`, created_at: `${day}T06:30:00.000Z`,
  merchant: null, raw_text: 'IDBI Bank Acct XX417 debited', ref_no: null, source: 'sms', account_tail: '417', category: 'Other', ...extra,
});

describe('reconcile', () => {
  const period = { periodStart: '2026-09-01', periodEnd: '2026-09-07', accountTail: '0417' };

  it('matches by UPI reference even when the dates disagree', () => {
    const r = reconcile(
      { ...period, rows: [row(0, '2026-09-01', 254, { ref: '612345678901' })] },
      [txn('a', '2026-09-05', 254, { raw_text: 'debited Rs 254 UPI:612345678901' })],
    );
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].via).toBe('ref');
    expect(r.adds).toHaveLength(0);
    expect(r.removes).toHaveLength(0);
  });

  it('matches by amount within ±2 days, preferring the nearest day', () => {
    const r = reconcile(
      { ...period, rows: [row(0, '2026-09-03', 47)] },
      [txn('far', '2026-09-05', 47), txn('near', '2026-09-03', 47)],
    );
    expect(r.matches[0].txn.id).toBe('near');
    // the unmatched same-amount txn inside the period becomes a removal proposal
    expect(r.removes.map((x) => x.txn.id)).toEqual(['far']);
  });

  it('pairs one-to-one: two identical debits need two ledger rows', () => {
    const r = reconcile(
      { ...period, rows: [row(0, '2026-09-02', 47), row(1, '2026-09-02', 47)] },
      [txn('a', '2026-09-02', 47)],
    );
    expect(r.matches).toHaveLength(1);
    expect(r.adds).toHaveLength(1);
  });

  it('proposes unmatched statement debits as adds and ignores credits', () => {
    const r = reconcile(
      { ...period, rows: [row(0, '2026-09-04', 999), { ...row(1, '2026-09-04', 2000), type: 'credit' }] },
      [],
    );
    expect(r.adds.map((a) => a.amount)).toEqual([999]);
    expect(r.creditsIgnored).toBe(1);
  });

  it('never proposes removing a credit-card spend or another account', () => {
    const r = reconcile({ ...period, rows: [] }, [
      txn('card', '2026-09-03', 220, { raw_text: 'Dear X, your SuperCard 4003 debited for INR 220.00', account_tail: '4003' }),
      txn('other-acct', '2026-09-03', 100, { account_tail: '9981' }),
      txn('outside', '2026-08-20', 100),
    ]);
    expect(r.removes).toHaveLength(0);
  });

  it('suggests keeping manual entries (cash) and last-day rows', () => {
    const r = reconcile({ ...period, rows: [] }, [
      txn('cash', '2026-09-03', 60, { source: 'manual', raw_text: '' }),
      txn('edge', '2026-09-07', 80),
      txn('ghost', '2026-09-04', 80),
    ]);
    const byId = Object.fromEntries(r.removes.map((x) => [x.txn.id, x.suggested]));
    expect(byId).toEqual({ cash: 'deny', edge: 'deny', ghost: 'approve' });
  });

  it('onThisAccount tolerates unknown tails', () => {
    expect(onThisAccount(txn('x', '2026-09-03', 1, { account_tail: null }), '0417')).toBe(true);
    expect(onThisAccount(txn('x', '2026-09-03', 1), null)).toBe(true);
  });
});

describe('statementDedupeKey', () => {
  it('is stable per row and distinguishes refs', () => {
    const a = statementDedupeKey('0417', { date: '2026-09-01', amount: 254, ref: '1', description: 'x' });
    expect(a).toBe(statementDedupeKey('0417', { date: '2026-09-01', amount: 254, ref: '1', description: 'y' }));
    expect(a).not.toBe(statementDedupeKey('0417', { date: '2026-09-01', amount: 254, ref: '2', description: 'x' }));
  });
});

describe('card spends and header meta', () => {
  it('recognises both SuperCard alert wordings as card spends', () => {
    const t = (raw: string) => txn('x', '2026-09-03', 10, { raw_text: raw, account_tail: null });
    expect(onThisAccount(t('USD 5.80 was spent on your SuperCard at OPENROUTER, INC . Available credit limit: INR 1,260.73'), '0417')).toBe(false);
    expect(onThisAccount(t('Dear Tolupunoori, your SuperCard 4003 debited for INR 20.00 on 07 Jul'), '0417')).toBe(false);
    // the settlement of the card is a bank debit and must stay reconcilable
    expect(onThisAccount(t('IDBI Bank Acct XX417 debited for Rs 1881.42 on 01-Aug-26; Utkarsh SuperCa credited'), '0417')).toBe(true);
  });

  it('reads bank, account and period from the header', async () => {
    const { statementMeta } = await import('../src/statements');
    expect(statementMeta(SAMPLE)).toEqual({ bank: 'IDBI Bank', accountTail: '0417', periodStart: '2026-09-01', periodEnd: '2026-09-07' });
  });
});

// Regression for the IDBI net-banking export format (validated against a real
// statement, 2026-09-22): rows begin with a serial number, the txn date carries a
// timestamp, there are separate Withdrawal/Deposit columns (direction from the
// running balance), rows are newest-first, and a long payee name WRAPS the running
// balance onto the next line. All values below are synthetic.
const IDBI_NETBANKING = `IDBI BANK LTD.
Account No : XXXXXXXX0417
Transaction Date From 05-Sep-2026 to 08-Sep-2026
S.No   Txn Date              Value Date    Description                         Cheque No   Withdrawals(Dr)   Deposits(Cr)   Balance(INR)
       Opening Balance                                                                                                        1,000.00
1      08/09/2026 10:00:00   08/09/2026    UPI/500000000004/KIRANA STORE/HDFC              50.00                              30,450.00
Our Toll-free numbers are:1800-22-1070 & 1800-209-4324.Chargeable number:022-67719100
S.No   Txn Date              Value Date    Description                         Cheque No   Withdrawals(Dr)   Deposits(Cr)   Balance(INR)
2      07/09/2026 09:30:00   07/09/2026    UPI/500000000003/A VERY LONG PAYEE NAME THAT    400.00
       WRAPS ONTO THE NEXT LINE/ICIC                                                                                          30,500.00
3      06/09/2026 08:00:00   06/09/2026    NEFT/500000000002/SALARY CREDIT                                   30,000.00        30,900.00
4      05/09/2026 07:00:00   05/09/2026    UPI/500000000001/COFFEE/YESB                    100.00                             900.00
`;

describe('IDBI net-banking export format', () => {
  const rows = heuristicParse(IDBI_NETBANKING);

  it('parses every row despite the S.No prefix and timestamps', () => {
    expect(rows).toHaveLength(4);
  });

  it('orders newest-first input into chronological order', () => {
    expect(rows.map((r) => r.date)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']);
  });

  it('derives direction from the running balance (no Dr/Cr marker on the line)', () => {
    const byDate = Object.fromEntries(rows.map((r) => [r.date, r.type]));
    expect(byDate['2026-09-06']).toBe('credit'); // salary
    expect(byDate['2026-09-05']).toBe('debit');
    expect(byDate['2026-09-08']).toBe('debit');
  });

  it('folds a wrapped continuation line back so its balance is captured', () => {
    const wrapped = rows.find((r) => r.date === '2026-09-07')!;
    expect(wrapped.amount).toBe(400);
    expect(wrapped.balance).toBe(30500);
    expect(wrapped.type).toBe('debit');
  });

  it('reconciles every running balance', () => {
    const bc = balanceCheck(rows);
    expect(bc.checked).toBe(3);
    expect(bc.ok).toBe(3);
  });

  it('extracts UPI refs and payees', () => {
    const coffee = rows.find((r) => r.date === '2026-09-05')!;
    expect(coffee.ref).toBe('500000000001');
    expect(coffee.merchant).toBe('COFFEE');
  });
});
