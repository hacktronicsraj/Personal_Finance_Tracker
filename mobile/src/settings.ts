import * as SecureStore from 'expo-secure-store';

export interface AppSettings {
  backendUrl: string;
  apiToken: string;
  deviceId: string;
}

const KEYS = {
  backendUrl: 'pft.backendUrl',
  apiToken: 'pft.apiToken',
  deviceId: 'pft.deviceId',
} as const;

function randomId(): string {
  // Non-crypto id is fine for a device identifier.
  return 'dev-' + Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

export async function getSettings(): Promise<AppSettings> {
  const [backendUrl, apiToken, existingId] = await Promise.all([
    SecureStore.getItemAsync(KEYS.backendUrl),
    SecureStore.getItemAsync(KEYS.apiToken),
    SecureStore.getItemAsync(KEYS.deviceId),
  ]);
  let deviceId = existingId ?? '';
  if (!deviceId) {
    deviceId = randomId();
    await SecureStore.setItemAsync(KEYS.deviceId, deviceId);
  }
  return { backendUrl: backendUrl ?? '', apiToken: apiToken ?? '', deviceId };
}

export async function saveConnection(backendUrl: string, apiToken: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.backendUrl, backendUrl.replace(/\/$/, ''));
  await SecureStore.setItemAsync(KEYS.apiToken, apiToken);
}

export async function isConfigured(): Promise<boolean> {
  const s = await getSettings();
  return !!s.backendUrl;
}
