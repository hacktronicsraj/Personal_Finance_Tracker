import type { Category, Classification, ParsedTxn } from './types';

/** The 11 standard categories, by display name. */
export const CATEGORIES: Category[] = [
  'Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Utilities',
  'Entertainment', 'Health', 'Transfers', 'Card Payment', 'Income', 'Other',
];

/** Collapse a payee to a stable join key (UPI handles, refs and punctuation removed). */
export function normalizeMerchant(merchant: string): string {
  let m = (merchant || '').toUpperCase();
  m = m.replace(/@[A-Z0-9.\-]+/g, '');
  m = m.replace(/\*.*$/g, '');
  m = m.replace(/\s*-\s*(ORDER|REF|TXN|ID)?\s*[0-9]+.*$/g, '');
  m = m.replace(/[^A-Z0-9 ]/g, ' ');
  return m.replace(/\s+/g, ' ').trim();
}

interface Rule {
  re: RegExp;
  cat: Category;
}

// Ordered by specificity — first match wins. Entries marked (local) came from
// this user's own corrected history: repeat payees the generic lists missed.
const RULES: Rule[] = [
  // Investing / broking — ahead of everything so an SIP autopay isn't read as a bill.
  { re: /groww|zerodha|upstox|kuvera|smallcase|\bsip\b|indmoney|paytm\s?money|angel\s?one|\bnps\b|mutual\s?fund|coin\b/i, cat: 'Transfers' },

  // Food delivery & eating out. Bundl Technologies = Swiggy's registered name.
  { re: /swiggy|bundl\s?tech|zomato|zamato|dominos|mcdonald|\bmcd\b|kfc|starbucks|cafe|coffee|restaurant|kitchen|dineout|eatfit|faasos|behrouz|biryani|dosa|tiffin|bakery|juice|chai\b/i, cat: 'Food & Dining' },
  { re: /nineties\s?kitche|toing|nannay?a|roast\s?24|pani\s?poori|curries|chikki|breakfast|lunch|dinner|snacks?\b/i, cat: 'Food & Dining' },

  // Quick-commerce & grocery. (local: Rathnadeep — a Hyderabad grocery chain.)
  { re: /bigbasket|blinkit|zepto|dmart|d-?mart|grofers|instamart|jiomart|milkbasket|licious|fresh(?:to)?home|reliance\s?fresh|rathnadeep|more\s?supermarket|ratnadeep|kirana|grocer/i, cat: 'Groceries' },

  // Transport. (local: Hyderabad Metro commute, RoyalBison self-drive rental.)
  { re: /uber|\bola\b|rapido|irctc|redbus|namma\s?yatri|metro|royal\s?bison|zoomcar|revv|drivezy|petrol|fuel|hpcl|iocl|bharat\s?petroleum|indian\s?oil|\bshell\b|fastag|parking|\bauto\b|cab\b|toll\b/i, cat: 'Transport' },

  { re: /amazon|flipkart|myntra|ajio|meesho|nykaa|tatacliq|snapdeal|decathlon|ikea|lifestyle|shoppers\s?stop|zudio|westside|pantaloons|trends\b/i, cat: 'Shopping' },

  // Subscriptions & media before the generic biller list. (local: Fancode, Google Play.)
  { re: /netflix|spotify|hotstar|prime\s?video|sonyliv|zee5|jiocinema|fancode|bookmyshow|\bpvr\b|inox|youtube\s?premium|gaana|google\s?play|app\s?store|itunes|steam\b|playstation|xbox/i, cat: 'Entertainment' },

  // Developer / SaaS spend is not a household utility. (local: OpenRouter, GoDaddy.)
  { re: /open\s?router|openai|anthropic|claude|cursor|github|vercel|netlify|cloudflare|digitalocean|\baws\b|godaddy|namecheap|hostinger|figma|notion|domain\b|hosting\b/i, cat: 'Other' },

  { re: /electricity|recharge|\bjio\b|airtel|vodafone|\bvi\b|bsnl|broadband|wifi|\bgas\b|water\s?bill|\bdth\b|tata\s?power|bescom|mseb|postpaid|prepaid|bill\s?pay|bbps|rent\b|maintenance|\bemi\b/i, cat: 'Bills & Utilities' },

  // (local: gym/fitness studios — built-in taxonomy files these under Health.)
  { re: /pharm|apollo|medplus|1mg|netmeds|hospital|clinic|medical|diagnostic|\blab\b|practo|cult\.?fit|healthkart|gym\b|fitness|crag\s?studio|swiss\s?beauty|salon|medicine/i, cat: 'Health' },
];

const INCOME_RE = /salary|payroll|interest\s?credit|dividend|refund|cashback|reimburse/i;

// Paying your own credit card from your bank (the payee is the card itself), vs a
// card SPEND (the card is the debited instrument). The spend is already recorded
// from the card's own alert, so the settlement is 'Card Payment' and kept out of totals.
const CARD_PAYEE_RE = /\b(?:super\s?ca(?:rd)?|credit\s?card|onecard|one\s?card|slice\s?card|uni\s?card|cred)\b/i;
const CARD_SPEND_RE = /\byour\s+(?:super\s?ca(?:rd)?|credit\s?card|card)\s*\d*\s+(?:debited|spent|used)\b/i;
const CARD_BILL_RE = /\b(?:card\s?(?:bill|payment)|payment\s+towards\s+(?:your\s+)?(?:credit\s?)?card)\b/i;

/** True when this debit settles one of your own cards rather than buying anything. */
export function isCardSettlement(merchant: string, rawText: string): boolean {
  if (CARD_SPEND_RE.test(rawText)) return false; // the card is what got debited — a real spend
  return CARD_PAYEE_RE.test(merchant) || CARD_BILL_RE.test(rawText);
}

/**
 * Offline, deterministic classifier — the fallback when no LLM is configured or a
 * live call fails. Keyword rules for common Indian merchants, UPI apps and billers.
 */
export function ruleClassify(input: ParsedTxn): Classification {
  const hay = `${input.merchant ?? ''} ${input.rawText ?? ''}`.trim();
  const merchant = (input.merchant ?? '').trim();

  if (input.direction === 'credit') {
    if (INCOME_RE.test(hay)) return { category: 'Income', merchant, confidence: 0.7, notes: 'rule:income' };
    const t = RULES.find((r) => r.re.test(hay) && r.cat === 'Transfers');
    if (t) return { category: 'Transfers', merchant, confidence: 0.6, notes: 'rule:transfer-credit' };
    return { category: 'Income', merchant, confidence: 0.45, notes: 'rule:credit-default' };
  }

  if (isCardSettlement(merchant, input.rawText ?? '')) {
    return { category: 'Card Payment', merchant, confidence: 0.9, notes: 'rule:card-settlement' };
  }

  for (const rule of RULES) {
    if (rule.re.test(hay)) return { category: rule.cat, merchant, confidence: 0.6, notes: `rule:${rule.cat}` };
  }
  return { category: 'Other', merchant, confidence: 0.3, notes: 'rule:default' };
}

/** Payees dropped entirely (never tracked, either direction) — e.g. Groww. */
const IGNORED_PAYEE_RE = /\bgroww\b/i;

export function isIgnoredPayee(merchant?: string | null, rawText?: string | null): boolean {
  return IGNORED_PAYEE_RE.test(merchant ?? '') || IGNORED_PAYEE_RE.test(rawText ?? '');
}
