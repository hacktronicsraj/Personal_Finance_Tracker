import type { Category } from './categories';
import type { Classification, ParsedTxn } from './types';

export function normalizeMerchant(merchant: string): string {
  let m = (merchant || '').toUpperCase();
  m = m.replace(/@[A-Z0-9.\-]+/g, '');
  m = m.replace(/\*.*$/g, '');
  m = m.replace(/\s*-\s*(ORDER|REF|TXN|ID)?\s*[0-9]+.*$/g, '');
  m = m.replace(/[^A-Z0-9 ]/g, ' ');
  return m.replace(/\s+/g, ' ').trim();
}

/**
 * Offline, deterministic classifier. Used as the "mock" LLM in local dev and as a
 * fallback when a live LLM call fails. Matches merchant/raw text against keyword
 * rules for common Indian merchants, UPI apps, banks and billers.
 */
interface Rule {
  re: RegExp;
  cat: Category;
}

const RULES: Rule[] = [
  { re: /swiggy|zomato|dominos|mcdonald|kfc|starbucks|cafe|restaurant|dineout|eatfit|faasos|behrouz/i, cat: 'Food & Dining' },
  { re: /bigbasket|blinkit|zepto|dmart|grofers|instamart|jiomart|milkbasket|licious|fresh(to|)home|reliance\s?fresh/i, cat: 'Groceries' },
  { re: /uber|ola|rapido|irctc|redbus|namma\s?yatri|metro|petrol|fuel|hpcl|iocl|bharat\s?petroleum|indian\s?oil|shell|fastag|parking/i, cat: 'Transport' },
  { re: /amazon|flipkart|myntra|ajio|meesho|nykaa|tatacliq|snapdeal|decathlon|ikea|lifestyle|shoppers\s?stop/i, cat: 'Shopping' },
  { re: /electricity|recharge|jio|airtel|vodafone|\bvi\b|bsnl|broadband|wifi|gas|water\s?bill|dth|tata\s?power|bescom|mseb|postpaid|bill\s?pay|bbps/i, cat: 'Bills & Utilities' },
  { re: /netflix|spotify|hotstar|prime\s?video|sonyliv|zee5|jiocinema|bookmyshow|pvr|inox|youtube\s?premium|gaana/i, cat: 'Entertainment' },
  { re: /pharm|apollo|medplus|1mg|netmeds|hospital|clinic|medical|diagnostic|lab|practo|cult\.?fit|healthkart/i, cat: 'Health' },
  { re: /groww|zerodha|upstox|kuvera|coin|mutual|smallcase|\bsip\b|invest|indmoney|paytm\s?money|angel\s?one|nps\b/i, cat: 'Transfers' },
];

const INCOME_RE = /salary|payroll|interest\s?credit|dividend|refund|cashback|reimburse/i;

export function ruleClassify(input: ParsedTxn & { rawText?: string }): Classification {
  const hay = `${input.merchant ?? ''} ${input.rawText ?? ''}`.trim();
  const merchant = (input.merchant ?? '').trim();

  // Incoming money is Income unless it clearly matches an investment/transfer rule.
  if (input.direction === 'credit') {
    if (INCOME_RE.test(hay)) return { category: 'Income', merchant, confidence: 0.7, notes: 'rule:income' };
    const t = RULES.find((r) => r.re.test(hay) && r.cat === 'Transfers');
    if (t) return { category: 'Transfers', merchant, confidence: 0.6, notes: 'rule:transfer-credit' };
    return { category: 'Income', merchant, confidence: 0.45, notes: 'rule:credit-default' };
  }

  for (const rule of RULES) {
    if (rule.re.test(hay)) {
      return { category: rule.cat, merchant, confidence: 0.6, notes: `rule:${rule.cat}` };
    }
  }
  return { category: 'Other', merchant, confidence: 0.3, notes: 'rule:default' };
}
