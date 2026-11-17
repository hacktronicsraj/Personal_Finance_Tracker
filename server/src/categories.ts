export const CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Transport',
  'Shopping',
  'Bills & Utilities',
  'Entertainment',
  'Health',
  'Transfers',
  'Card Payment',
  'Income',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * What each category means for this user — Jev's choice criteria and the LLM's
 * category list. Indian-context examples (UPI payees, local chains) because the
 * bare names are ambiguous: a ₹80 UPI payment to a person's name is usually an
 * auto driver or a street-food stall, not a "transfer".
 */
export const CATEGORY_GUIDE: Record<Category, string> = {
  'Food & Dining': 'Restaurants, cafes, food delivery (Swiggy / Bundl Technologies, Zomato), street food, tea, snacks, tiffin and curry points',
  Groceries: 'Supermarkets, kirana stores, quick-commerce groceries (Zepto, Blinkit, Instamart, BigBasket, Ratnadeep), vegetables, milk',
  Transport: 'Auto / cab / bike-taxi rides (Rapido, Uber, Ola, or a UPI payment to an individual driver), metro, fuel and petrol stations, car rentals (Zoomcar), parking, tolls',
  Shopping: 'Clothing, electronics, household items, e-commerce (Amazon, Flipkart, Myntra, Zudio)',
  'Bills & Utilities': 'Electricity, water, gas, mobile / broadband recharge (Airtel, Jio), rent, EMIs, recurring bills and software subscriptions',
  Entertainment: 'Streaming and media (Netflix, Spotify, Fancode, Google Play), movies, games, events',
  Health: 'Medicines, pharmacies, doctors, hospitals, clinics, diagnostics, skin/hair care, gyms and fitness',
  Transfers: 'Money sent to family or friends that is not a purchase, investments (Groww, SIP, mutual funds), lending',
  'Card Payment': "Paying off one's own credit card bill (the payee is the card itself, e.g. SuperCard)",
  Income: 'Money received: salary, refunds, cashback',
  Other: 'Bank charges and fees, and anything that fits none of the above',
};

export function isCategory(x: string): x is Category {
  return (CATEGORIES as readonly string[]).includes(x);
}

/**
 * Categories that move money without being consumption, so they must not land in
 * spend totals. 'Card Payment' settles a credit-card bill whose individual spends
 * the card's own SMS alerts already recorded — counting the settlement too bills
 * the same rupees twice (₹3,534 of August's total came from exactly this).
 * The transactions stay visible in the activity list; only the aggregates skip them.
 */
export const NON_SPEND_CATEGORIES: readonly string[] = ['Card Payment'];
