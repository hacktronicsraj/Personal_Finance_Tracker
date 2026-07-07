import { describe, expect, it } from 'vitest';
import { isBankSender, isFinancialSms, parsePayment, parseTransaction } from './parser';

// The three real IDBI messages supplied by the user.
const SAMPLES = [
  'IDBI Bank Acct XX417 debited for Rs 9000.00 on 02-Jul-26; Bal Rs 432.58 Groww Invest Te credited. UPI:618359694589. To Block UPI send SMS UPIBLOCK <Mob. No> to 07799000328 or call 18002094324-IDBI Bank',
  'IDBI Bank Acct XX417 debited for Rs 90.00 on 23-Jun-26; Bal Rs 22100.37 N ANDAALU credited. UPI:617477562322. To Block UPI send SMS UPIBLOCK <Mob. No> to 07799000328 or call 18002094324-IDBI Bank',
  'IDBI Bank Acct XX417 debited for Rs 90.00 on 21-Jun-26; Bal Rs 8338.90 SATYAWAN JADAV credited. UPI:653829330540. To Block UPI send SMS UPIBLOCK <Mob. No> to 07799000328 or call 18002094324-IDBI Bank',
];

describe('isFinancialSms', () => {
  it('accepts real transaction alerts', () => {
    for (const s of SAMPLES) expect(isFinancialSms(s)).toBe(true);
  });
  it('rejects OTP messages', () => {
    expect(isFinancialSms('123456 is your OTP for a txn of Rs 500. Do not share.')).toBe(false);
  });
  it('rejects promos with no amount', () => {
    expect(isFinancialSms('Get a personal loan today! Apply now.')).toBe(false);
  });
  it('accepts a money token from a known bank sender even with an odd verb', () => {
    expect(isFinancialSms('Rs 250.00 towards your bill', 'VK-PAYTMB')).toBe(true);
    expect(isFinancialSms('Rs 250.00 towards your bill', 'AX-IDBIBK')).toBe(true);
  });
  it('still rejects money text from an unknown promo sender without a hint verb', () => {
    expect(isFinancialSms('Grab Rs 500 off your next order!', 'AD-BIGSAV')).toBe(false);
  });
});

describe('isBankSender', () => {
  it('recognizes Indian bank/UPI sender IDs', () => {
    for (const s of ['AX-IDBIBK', 'VM-HDFCBK', 'JD-SBIINB', 'VK-PAYTMB', 'AD-ICICIB', 'BP-KOTAKB'])
      expect(isBankSender(s)).toBe(true);
  });
  it('rejects a random promo sender', () => {
    expect(isBankSender('AD-BIGSAV')).toBe(false);
    expect(isBankSender(undefined)).toBe(false);
  });
});

describe('parsePayment — shared payment-app text (debit-first)', () => {
  it('PhonePe: Paid ₹250 to Blinkit', () => {
    const p = parsePayment('Paid ₹250 to Blinkit successfully')!;
    expect(p.amount).toBe(250);
    expect(p.direction).toBe('debit');
    expect(p.merchant).toBe('Blinkit');
  });
  it('Paytm: Rs.1,200 paid to Airtel Postpaid on 04-Jul-26', () => {
    const p = parsePayment('Rs.1,200 paid to Airtel Postpaid on 04-Jul-26')!;
    expect(p.amount).toBe(1200);
    expect(p.merchant).toBe('Airtel Postpaid');
    expect(p.occurredAt).toBe('2026-07-04T00:00:00.000Z');
  });
  it('defaults direction to debit for a bare receipt', () => {
    expect(parsePayment('₹99 to swiggy@ybl')!.direction).toBe('debit');
  });
  it('returns null when there is no amount', () => {
    expect(parsePayment('Payment successful')).toBeNull();
  });
});

describe('parseTransaction — IDBI sample 1 (Groww)', () => {
  const p = parseTransaction(SAMPLES[0])!;
  it('is parsed', () => expect(p).not.toBeNull());
  it('direction=debit', () => expect(p.direction).toBe('debit'));
  it('amount=9000', () => expect(p.amount).toBe(9000));
  it('accountTail=417', () => expect(p.accountTail).toBe('417'));
  it('bank=IDBI Bank', () => expect(p.bank).toBe('IDBI Bank'));
  it('balance=432.58', () => expect(p.balance).toBe(432.58));
  it('refNo=618359694589', () => expect(p.refNo).toBe('618359694589'));
  it('merchant=Groww Invest Te (before "credited")', () => expect(p.merchant).toBe('Groww Invest Te'));
  it('occurredAt=2026-07-02', () => expect(p.occurredAt).toBe('2026-07-02T00:00:00.000Z'));
  it('does NOT flip to credit despite the word "credited"', () => expect(p.direction).not.toBe('credit'));
});

describe('parseTransaction — IDBI samples 2 & 3', () => {
  it('sample 2: N ANDAALU, Rs 90, 23-Jun-26', () => {
    const p = parseTransaction(SAMPLES[1])!;
    expect(p.amount).toBe(90);
    expect(p.direction).toBe('debit');
    expect(p.merchant).toBe('N ANDAALU');
    expect(p.balance).toBe(22100.37);
    expect(p.occurredAt).toBe('2026-06-23T00:00:00.000Z');
  });
  it('sample 3: SATYAWAN JADAV, Rs 90, 21-Jun-26', () => {
    const p = parseTransaction(SAMPLES[2])!;
    expect(p.amount).toBe(90);
    expect(p.merchant).toBe('SATYAWAN JADAV');
    expect(p.refNo).toBe('653829330540');
    expect(p.occurredAt).toBe('2026-06-21T00:00:00.000Z');
  });
});

describe('parseTransaction — other common formats', () => {
  it('HDFC card spend', () => {
    const p = parseTransaction('Rs.499.00 spent on HDFC Bank Card x1234 at SWIGGY on 02-07-26. Avl bal Rs.5000')!;
    expect(p.direction).toBe('debit');
    expect(p.amount).toBe(499);
    expect(p.merchant?.toUpperCase()).toContain('SWIGGY');
  });
  it('incoming credit / salary', () => {
    const p = parseTransaction('Your A/c XX9012 credited with Rs 50000.00 on 01-Jul-26 by ACME PAYROLL. Avl Bal Rs 60000')!;
    expect(p.direction).toBe('credit');
    expect(p.amount).toBe(50000);
  });
  it('returns null for non-transaction text', () => {
    expect(parseTransaction('Hello, are we meeting tomorrow?')).toBeNull();
  });
});
