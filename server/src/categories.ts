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

export function isCategory(x: string): x is Category {
  return (CATEGORIES as readonly string[]).includes(x);
}
