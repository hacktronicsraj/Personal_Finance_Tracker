import * as Updates from 'expo-updates';

/**
 * Over-the-air updates (EAS Update).
 *
 * Only the JS bundle and assets travel this way. Anything that changes the native
 * project — a new native module, an Android permission, the withSmsReceiver /
 * withSpendWidget config plugins — still needs a rebuilt APK. The `fingerprint`
 * runtime-version policy in app.config.ts enforces that: a build only ever
 * receives updates whose native fingerprint matches its own, so a JS bundle can
 * never land on an APK missing the native code it calls.
 *
 * Nothing here runs in Expo Go or a bare `expo run:android` debug build —
 * Updates.isEnabled is false there, and every function degrades to a no-op.
 */

export interface UpdateState {
  enabled: boolean;
  /** Short id of the running bundle, or 'embedded' when running the built-in one. */
  currentId: string;
  channel: string | null;
  checking: boolean;
}

export function currentUpdateInfo(): UpdateState {
  return {
    enabled: Updates.isEnabled,
    currentId: Updates.updateId ? Updates.updateId.slice(0, 8) : 'embedded',
    channel: Updates.channel ?? null,
    checking: false,
  };
}

/**
 * Check for a newer bundle and download it. Returns whether one is ready to apply.
 * Never throws — a failed check is not worth interrupting the user for.
 */
export async function checkForUpdate(): Promise<{ available: boolean; error?: string }> {
  if (!Updates.isEnabled) return { available: false, error: 'Updates are off in this build' };
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return { available: false };
    await Updates.fetchUpdateAsync();
    return { available: true };
  } catch (e: any) {
    return { available: false, error: String(e?.message ?? e) };
  }
}

/** Restart into the downloaded bundle. */
export async function applyUpdate(): Promise<void> {
  await Updates.reloadAsync();
}
