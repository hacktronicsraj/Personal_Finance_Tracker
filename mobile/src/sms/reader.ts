import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Thin wrappers around the native SMS libraries. These native modules only exist
 * in a custom dev/APK build (never in Expo Go), so every access is guarded — the
 * app still loads on unsupported platforms, it just can't read SMS there.
 */

export interface InboxMessage {
  body: string;
  address: string;
  date: number; // epoch ms
}

// --- Real-time incoming SMS (@maniac-tech/react-native-expo-read-sms) ---
let readSmsLib: any = null;
try {
  readSmsLib = require('@maniac-tech/react-native-expo-read-sms');
} catch {
  readSmsLib = null;
}

// --- Inbox reader (react-native-get-sms-android) ---
let SmsAndroid: any = null;
try {
  SmsAndroid = require('react-native-get-sms-android').default ?? require('react-native-get-sms-android');
} catch {
  SmsAndroid = null;
}

export function smsSupported(): boolean {
  return Platform.OS === 'android' && (!!readSmsLib || !!SmsAndroid);
}

export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const [read, receive] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
    ]);
    return read && receive;
  } catch {
    return false;
  }
}

export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    // Request directly, then verify with our own check — the read-sms library's
    // requestReadSMSPermission() returns false even after a successful grant.
    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    return hasSmsPermission();
  } catch {
    return false;
  }
}

/** Subscribe to incoming SMS while the app process is alive. Returns an unsubscribe fn. */
export function startSmsListener(onMessage: (body: string, sender?: string) => void): () => void {
  if (!readSmsLib?.startReadSMS) return () => {};
  try {
    readSmsLib.startReadSMS(
      (status: string, sms: string, _error: unknown) => {
        if (status === 'success' && sms) onMessage(sms);
      },
      (_error: unknown) => {},
    );
  } catch {
    /* ignore */
  }
  // The library manages a single global receiver; nothing to unsubscribe.
  return () => {};
}

/** Read recent inbox messages for backfill/reconciliation on launch. */
export async function readInbox(sinceMs?: number, maxCount = 200): Promise<InboxMessage[]> {
  if (!SmsAndroid?.list) return [];
  const filter = JSON.stringify({
    box: 'inbox',
    maxCount,
    ...(sinceMs ? { minDate: sinceMs } : {}),
  });
  return new Promise((resolve) => {
    try {
      SmsAndroid.list(
        filter,
        () => resolve([]),
        (_count: number, smsList: string) => {
          try {
            const arr = JSON.parse(smsList) as { body: string; address: string; date: number }[];
            resolve(arr.map((m) => ({ body: m.body, address: m.address, date: m.date })));
          } catch {
            resolve([]);
          }
        },
      );
    } catch {
      resolve([]);
    }
  });
}
