import * as SecureStore from 'expo-secure-store';

/**
 * App-lock settings, persisted in the OS-encrypted SecureStore. Biometric is the
 * primary factor; an optional 4-digit PIN is the fallback for devices without
 * biometrics enrolled. Re-lock after >60s in the background (threshold below).
 */
const K_ENABLED = 'lock.enabled';
const K_PIN = 'lock.pin';

/** Re-lock when the app returns to foreground after this long in the background. */
export const LOCK_AFTER_MS = 60_000;

export async function isLockEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(K_ENABLED)) === '1';
}

export async function setLockEnabled(enabled: boolean): Promise<void> {
  if (enabled) await SecureStore.setItemAsync(K_ENABLED, '1');
  else await SecureStore.deleteItemAsync(K_ENABLED);
}

export async function hasPin(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(K_PIN));
}

export async function setPin(pin: string): Promise<void> {
  await SecureStore.setItemAsync(K_PIN, pin);
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(K_PIN);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(K_PIN);
  return !!stored && stored === pin;
}
