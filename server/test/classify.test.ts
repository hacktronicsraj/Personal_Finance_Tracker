import { describe, expect, it } from 'vitest';
import { ruleClassify, normalizeMerchant, isCardSettlement } from '../src/classify';
import { isLearnableMerchant } from '../src/db';

describe('ruleClassify', () => {
  it('classifies a Groww UPI investment debit as Transfers', () => {
    const r = ruleClassify({
      amount: 9000,
      direction: 'debit',
      merchant: 'Groww Invest Te',
      rawText: 'IDBI Bank Acct XX417 debited for Rs 9000.00 ... Groww Invest Te credited. UPI:618359694589',
    });
    expect(r.category).toBe('Transfers');
  });

  it('classifies food delivery as Food & Dining', () => {
    expect(ruleClassify({ amount: 350, direction: 'debit', merchant: 'SWIGGY' }).category).toBe('Food & Dining');
    expect(ruleClassify({ amount: 500, direction: 'debit', merchant: 'Zomato Ltd' }).category).toBe('Food & Dining');
  });

  it('classifies quick-commerce as Groceries', () => {
    expect(ruleClassify({ amount: 800, direction: 'debit', merchant: 'BLINKIT' }).category).toBe('Groceries');
  });

  it('classifies rides/fuel as Transport', () => {
    expect(ruleClassify({ amount: 220, direction: 'debit', merchant: 'Uber India' }).category).toBe('Transport');
    expect(ruleClassify({ amount: 2000, direction: 'debit', merchant: 'HPCL Fuel' }).category).toBe('Transport');
  });

  it('classifies marketplaces as Shopping', () => {
    expect(ruleClassify({ amount: 1500, direction: 'debit', merchant: 'Amazon Pay' }).category).toBe('Shopping');
  });

  it('classifies utilities as Bills & Utilities', () => {
    expect(ruleClassify({ amount: 999, direction: 'debit', merchant: 'Airtel Recharge' }).category).toBe('Bills & Utilities');
  });

  it('treats generic credit as Income', () => {
    const r = ruleClassify({ amount: 50000, direction: 'credit', merchant: 'ACME PAYROLL', rawText: 'salary credited' });
    expect(r.category).toBe('Income');
  });

  it('falls back to Other for unknown debit', () => {
    expect(ruleClassify({ amount: 90, direction: 'debit', merchant: 'SATYAWAN JADAV' }).category).toBe('Other');
  });

  it('books a bank-to-own-card payment as Card Payment, not spend', () => {
    const r = ruleClassify({
      amount: 1653,
      direction: 'debit',
      merchant: 'Utkarsh SuperCard',
      rawText:
        'IDBI Bank Acct XX417 debited for Rs 1653.00 on 11-Aug-26; Bal Rs 16924.73 Utkarsh SuperCa credited. UPI:622329376909',
    });
    expect(r.category).toBe('Card Payment');
  });

  it('still treats a spend ON the card as a real purchase', () => {
    const r = ruleClassify({
      amount: 1653,
      direction: 'debit',
      merchant: 'SuperCard Payment',
      rawText:
        'Dear Tolupunoori, your SuperCard 4003 debited for INR 1,653.00 on 08 Aug 10:12 PM for UPI - 622025204646',
    });
    expect(r.category).not.toBe('Card Payment');
  });

  it('routes dev/SaaS spend away from Bills & Utilities', () => {
    expect(ruleClassify({ amount: 648, direction: 'debit', merchant: 'Open Router Credits' }).category).toBe('Other');
    expect(ruleClassify({ amount: 399, direction: 'debit', merchant: 'Google Play' }).category).toBe('Entertainment');
  });

  it('knows the local repeat payees seen in the history', () => {
    expect(ruleClassify({ amount: 47, direction: 'debit', merchant: 'Hyderabad Metro' }).category).toBe('Transport');
    expect(ruleClassify({ amount: 2297, direction: 'debit', merchant: 'Bundl Technologies' }).category).toBe('Food & Dining');
    expect(ruleClassify({ amount: 630, direction: 'debit', merchant: 'Rathnadeep' }).category).toBe('Groceries');
    expect(ruleClassify({ amount: 2687, direction: 'debit', merchant: 'RoyalBison Auto' }).category).toBe('Transport');
    expect(ruleClassify({ amount: 675, direction: 'debit', merchant: 'Zudio' }).category).toBe('Shopping');
  });
});

describe('isCardSettlement', () => {
  it('separates paying the card from spending on it', () => {
    expect(isCardSettlement('Utkarsh SuperCa', '... Bal Rs 100 Utkarsh SuperCa credited.')).toBe(true);
    expect(isCardSettlement('SuperCard Payment', 'your SuperCard 4003 debited for INR 1,653.00')).toBe(false);
  });
});

describe('isLearnableMerchant', () => {
  it('rejects placeholder labels that span many categories', () => {
    // Corrected to six different categories in the real feedback history.
    expect(isLearnableMerchant('SuperCard Payment')).toBe(false);
    expect(isLearnableMerchant('UPI Transfer')).toBe(false);
    expect(isLearnableMerchant('?')).toBe(false);
    expect(isLearnableMerchant('dispute call 18003097986 - Utkarsh SFBL')).toBe(false);
  });
  it('accepts real counterparties', () => {
    expect(isLearnableMerchant('Hyderabad Metro')).toBe(true);
    expect(isLearnableMerchant('SATYAWAN JADAV')).toBe(true);
  });
});

describe('normalizeMerchant', () => {
  it('strips UPI handles, order numbers, and cleans whitespace', () => {
    expect(normalizeMerchant('Swiggy*Order-4821')).toBe('SWIGGY');
    expect(normalizeMerchant('UBER@okicici')).toBe('UBER');
    expect(normalizeMerchant('ZOMATO-ORDER 8129')).toBe('ZOMATO');
    expect(normalizeMerchant('Amazon Pay - TXN123')).toBe('AMAZON PAY');
    expect(normalizeMerchant('  blinkit   @hdfc ')).toBe('BLINKIT');
  });
});
