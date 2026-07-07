import { describe, expect, it } from 'vitest';
import { ruleClassify } from '../src/classify';

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
});
