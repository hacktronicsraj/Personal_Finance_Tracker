import * as BackgroundFetch from 'expo-background-fetch';

/**
 * We do NOT scan the SMS inbox in the background. Capture is limited to live
 * incoming SMS (native receiver), shared screenshots, and manual entry — no
 * history/backfill. This tears down the periodic inbox-scan task that an earlier
 * build may have registered.
 */
export const RECONCILE_TASK = 'PFT_RECONCILE';

export async function unregisterReconcileTask(): Promise<void> {
  try {
    await BackgroundFetch.unregisterTaskAsync(RECONCILE_TASK);
  } catch {
    // Not registered (fresh install) — nothing to do.
  }
}
