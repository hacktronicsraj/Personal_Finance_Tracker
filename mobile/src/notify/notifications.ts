import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CATEGORIES, formatINR } from '../config';
import type { TxnRow } from '../api/client';

export const CLASSIFY_CATEGORY = 'CLASSIFY_TXN';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function configureNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('transactions', {
      name: 'Transaction alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/** Pick 2 alternate categories that differ from the guess. */
function alternates(guess: string): string[] {
  const common = ['Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Bills & Utilities'];
  return common.filter((c) => c !== guess).slice(0, 2);
}

/**
 * Fire the "classify this purchase" notification with quick-action buttons.
 * Buttons: [✓ guess] [alt1] [alt2] [Other…]. Category id is re-registered per
 * notification so the button titles reflect the current guess.
 */
export async function presentClassifyNotification(txn: TxnRow): Promise<void> {
  const guess = CATEGORIES.includes(txn.category as any) ? txn.category : 'Other';
  const alts = alternates(guess);

  // Ensure the channel exists — the headless background task never runs
  // configureNotifications(), so create it idempotently here too.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('transactions', {
      name: 'Transaction alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    });
  }

  // Category buttons resolve the notification WITHOUT opening the app
  // (opensAppToForeground defaults to true, which is why it was launching the app).
  // Only "Other…" opens the app, to reach the full picker.
  await Notifications.setNotificationCategoryAsync(CLASSIFY_CATEGORY, [
    { identifier: `cat:${guess}`, buttonTitle: `✓ ${guess}`, options: { opensAppToForeground: false } },
    { identifier: `cat:${alts[0]}`, buttonTitle: alts[0], options: { opensAppToForeground: false } },
    { identifier: `cat:${alts[1]}`, buttonTitle: alts[1], options: { opensAppToForeground: false } },
    { identifier: 'other', buttonTitle: 'Other…', options: { opensAppToForeground: true } },
  ]);

  const title = `${formatINR(txn.amount)} ${txn.direction === 'debit' ? 'spent' : 'received'} · ${txn.merchant ?? 'Unknown'}`;
  const body = `Best guess: ${guess}. Confirm?`;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      categoryIdentifier: CLASSIFY_CATEGORY,
      data: { txnId: txn.id, guess },
    },
    trigger: Platform.OS === 'android' ? { channelId: 'transactions' } : null,
  });
}
