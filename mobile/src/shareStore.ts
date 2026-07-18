/**
 * A module-level stash for an incoming shared payment.
 *
 * expo-share-intent reparents the activity on a cold-start share, which tears down
 * and recreates the React tree 2–3 times. The shared payload arrives on a transient
 * mount and is gone by the time the navigator is ready. Holding it OUTSIDE React
 * lets us capture it the instant it appears and navigate once things settle.
 */
export type PendingShare = { imageUri?: string; text?: string };

export const shareStore: { pending: PendingShare | null } = { pending: null };
