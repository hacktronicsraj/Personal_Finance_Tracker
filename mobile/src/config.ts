export const CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Transport',
  'Shopping',
  'Bills & Utilities',
  'Entertainment',
  'Health',
  'Transfers',
  'Income',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Category color system (AMOLED design):
 * - `color`  saturated hue — dots, bars, donut slices, selected pills
 * - `light`  readable-on-black variant — tile initials, tinted text
 * `icon` survives for notification copy only; the UI itself uses initials + dots.
 */
export const CATEGORY_META: Record<Category, { color: string; light: string; icon: string }> = {
  'Food & Dining': { color: '#ef4444', light: '#fca5a5', icon: '🍽️' },
  Groceries: { color: '#f59e0b', light: '#fcd34d', icon: '🛒' },
  Transport: { color: '#3b82f6', light: '#93c5fd', icon: '🚗' },
  Shopping: { color: '#8b5cf6', light: '#c4b5fd', icon: '🛍️' },
  'Bills & Utilities': { color: '#14b8a6', light: '#5eead4', icon: '⚡' },
  Entertainment: { color: '#ec4899', light: '#f9a8d4', icon: '🎬' },
  Health: { color: '#10b981', light: '#6ee7b7', icon: '💊' },
  Transfers: { color: '#8A8F9E', light: '#c8ccd8', icon: '🔁' },
  Income: { color: '#22c55e', light: '#86efac', icon: '💰' },
  Other: { color: '#94a3b8', light: '#aab1c2', icon: '❓' },
};

const meta = (name: string) => (CATEGORY_META as Record<string, { color: string; light: string; icon: string }>)[name];

export function categoryColor(name: string): string {
  return meta(name)?.color ?? '#94a3b8';
}

/** Readable-on-black text variant of the category color. */
export function categoryLight(name: string): string {
  return meta(name)?.light ?? '#aab1c2';
}

/** ~14% alpha wash of the category color — merchant tile backgrounds. */
export function categoryTint(name: string): string {
  return categoryColor(name) + '24';
}

export function categoryIcon(name: string): string {
  return meta(name)?.icon ?? '❓';
}

/** Short label for filter chips ("Bills & Utilities" → "Bills"). */
export function categoryShort(name: string): string {
  return name.split(' ')[0];
}

export const formatINR = (n: number) =>
  `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Number only, for split-color ₹ rendering. */
export const formatNum = (n: number) =>
  n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
