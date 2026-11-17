/**
 * A module-level stash for an incoming shared payment.
 *
 * expo-share-intent reparents the activity on a cold-start share, which tears down
 * and recreates the React tree 2–3 times. The shared payload arrives on a transient
 * mount and is gone by the time the navigator is ready. Holding it OUTSIDE React
 * lets us capture it the instant it appears and navigate once things settle.
 */
export type PendingShare = { imageUri?: string; text?: string; pdfUri?: string; pdfName?: string; chatgptUrl?: string };

export const shareStore: { pending: PendingShare | null } = { pending: null };

/** Pull a ChatGPT share link out of shared text (the ChatGPT app shares a URL, or
 * a URL wrapped in a sentence). Returns the bare URL, or null if there isn't one. */
export function chatgptShareLink(text?: string | null): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/(?:chatgpt\.com|chat\.openai\.com)\/share\/[0-9a-zA-Z-]{16,}/);
  return m ? m[0] : null;
}
