import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CATEGORIES, formatINR } from '../config';
import type { TxnRow } from '../api/client';

export const CLASSIFY_CATEGORY = 'CLASSIFY_TXN';
export const REPORTS_CHANNEL = 'reports';

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

/**
 * Schedule the repeating weekly local notification (Sun 20:15 IST) that points at
 * the latest report. Chosen over background polling: zero background work, zero
 * battery — the server cron generates the report regardless. Idempotent: it won't
 * stack duplicates across launches.
 */
export async function scheduleWeeklyReportNotification(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REPORTS_CHANNEL, {
      name: 'Weekly report',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (scheduled.some((n) => (n.content.data as { type?: string })?.type === 'weekly-report')) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Your weekly spending report is ready 📊',
      body: 'Tap to see where your money went this week.',
      data: { type: 'weekly-report' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1, // 1 = Sunday (device-local; IST for this user)
      hour: 20,
      minute: 15,
      channelId: REPORTS_CHANNEL,
    },
  });
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

/* ─────────────────────── Personal-assistant reminders ─────────────────────── */

export const ASSISTANT_CHANNEL = 'assistant';
const LEARNING_ID = 'learning-checkin';
const STATEMENT_TAG = 'statement-reminder';

async function ensureAssistantChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ASSISTANT_CHANNEL, {
      name: 'Assistant',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
    });
  }
}

/**
 * The nightly learning check-in was removed (replaced by flashcards + the 30-min
 * cap). Cancel any check-in that older installs scheduled so it stops firing.
 */
export async function cancelLearningCheckin(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(LEARNING_ID);
  } catch {}
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    if ((n.content.data as { type?: string })?.type === 'learning-checkin') {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  }
}

/**
 * Weekly bank-statement reminder: Friday 20:00, then every 8h through the weekend
 * until a statement is uploaded. expo-notifications can't express "repeat until",
 * so we lay down a handful of one-off reminders and clear them all the moment a
 * statement lands (see clearStatementReminders). Re-armed each week by
 * rearmStatementRemindersIfNeeded on foreground.
 */
export async function scheduleStatementReminders(): Promise<void> {
  await ensureAssistantChannel();
  await clearStatementReminders();
  const now = new Date();
  // Next Friday 20:00 local (today if it's Friday before 20:00).
  const next = new Date(now);
  const daysToFri = (5 - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + daysToFri);
  next.setHours(20, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);

  // Friday 20:00 + every 8h up to +40h (through Sunday afternoon): 6 nudges.
  for (let i = 0; i < 6; i++) {
    const when = new Date(next.getTime() + i * 8 * 3600_000);
    await Notifications.scheduleNotificationAsync({
      identifier: `${STATEMENT_TAG}-${i}`,
      content: {
        title: i === 0 ? 'Weekly reconciliation 🧾' : 'Still pending: bank statement 🧾',
        body: 'Share this week’s bank statement PDF to reconcile your spending.',
        data: { type: 'statement-reminder' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: ASSISTANT_CHANNEL },
    });
  }
}

/** Cancel all pending statement nudges — call right after a statement is uploaded. */
export async function clearStatementReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { type?: string })?.type === 'statement-reminder')
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** Re-arm next week's nudges if none are pending (they were consumed or cleared). */
export async function rearmStatementRemindersIfNeeded(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const pending = scheduled.filter((n) => (n.content.data as { type?: string })?.type === 'statement-reminder');
  if (pending.length === 0) await scheduleStatementReminders();
}
