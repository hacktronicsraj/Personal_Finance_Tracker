import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { updateCategory } from '../src/api/client';
import { unregisterReconcileTask } from '../src/background';
import { setLocalCategory } from '../src/db/database';
import {
  cancelLearningCheckin,
  configureNotifications,
  rearmStatementRemindersIfNeeded,
  scheduleStatementReminders,
  scheduleWeeklyReportNotification,
} from '../src/notify/notifications';
import { reconcileSessionOnForeground } from '../src/focus';
import { chatgptShareLink, shareStore } from '../src/shareStore';
import { ingestSms, syncBackend } from '../src/sms/ingest';
import { startSmsListener } from '../src/sms/reader';
import { isLockEnabled, LOCK_AFTER_MS } from '../src/lock';
import { LockScreen } from '../src/components/LockScreen';

const queryClient = new QueryClient();

// Dedupe so the same tap isn't applied twice (listener + last-response net).
const handledResponses = new Set<string>();

/**
 * Apply a notification response. Category buttons record the choice in the
 * background (no app open); the body tap / "Other…" opens the classify screen.
 */
async function handleNotificationResponse(response: Notifications.NotificationResponse) {
  const req = response.notification.request;
  const key = `${req.identifier}:${response.actionIdentifier}`;
  if (handledResponses.has(key)) return;
  handledResponses.add(key);

  const data = req.content.data as { txnId?: string; type?: string };
  // Weekly-report notification → open the latest WEEKLY report specifically
  // (scoped so a later-dated monthly report doesn't hijack "latest").
  if (data?.type === 'weekly-report') {
    router.push({ pathname: '/report/[id]', params: { id: 'latest', type: 'weekly' } });
    return;
  }
  // Weekly statement reminder → open the statements screen to upload one.
  if (data?.type === 'statement-reminder') {
    router.push('/statements');
    return;
  }

  const txnId = data?.txnId;
  if (!txnId) return;
  const action = response.actionIdentifier;

  if (action.startsWith('cat:')) {
    const category = action.slice(4);
    setLocalCategory(txnId, category).catch(() => {});
    updateCategory(txnId, category)
      .then(() => queryClient.invalidateQueries())
      .catch(() => {
        /* offline: reconciles on next sync */
      });
  } else if (action === 'other' || action === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    router.push(`/classify/${txnId}`);
  }
}

function AppShell() {
  const listenerStarted = useRef(false);
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  // undefined until the root navigator is mounted — navigating before then is a no-op.
  const navState = useRootNavigationState();

  // App lock: `checking` covers the brief async read on cold start so no content
  // flashes before we know; `locked` shows the overlay. Both render ON TOP of the
  // Stack so the tree (and the share-intent stash) stays mounted underneath.
  const [checking, setChecking] = useState(true);
  const [locked, setLocked] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    isLockEnabled()
      .then((en) => setLocked(en))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    configureNotifications().catch(() => {});
    scheduleWeeklyReportNotification().catch(() => {}); // idempotent weekly local reminder
    cancelLearningCheckin().catch(() => {}); // check-in removed — clear it from older installs
    scheduleStatementReminders().catch(() => {}); // Fri 8pm + every 8h until uploaded
    unregisterReconcileTask().catch(() => {}); // no inbox scanning — live capture only

    // Real-time SMS → ingest pipeline.
    if (!listenerStarted.current) {
      listenerStarted.current = true;
      startSmsListener((body, sender) => {
        ingestSms(body, sender).catch(() => {});
      });
    }

    // Handle quick-actions while the app is alive, plus any tap that happened
    // while it was killed (delivered on next launch).
    const sub = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    Notifications.getLastNotificationResponseAsync()
      .then((r) => { if (r) handleNotificationResponse(r); })
      .catch(() => {});

    // On foreground: flush the offline queue and pull backend changes into the
    // local cache. No SMS inbox scan — only live captures / shares / manual entries.
    // Also re-lock if we were backgrounded longer than the threshold.
    syncBackend().catch(() => {});
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (backgroundedAt.current && Date.now() - backgroundedAt.current > LOCK_AFTER_MS) {
          isLockEnabled().then((en) => { if (en) setLocked(true); }).catch(() => {});
        }
        backgroundedAt.current = null;
        syncBackend().catch(() => {});
        reconcileSessionOnForeground().catch(() => {}); // close any Instagram session the service missed
        rearmStatementRemindersIfNeeded().catch(() => {}); // keep next week's nudges armed
      } else if (state === 'background' || state === 'inactive') {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
      }
    });

    return () => {
      sub.remove();
      appSub.remove();
    };
  }, []);

  // A payment shared from Google Pay (screenshot) / PhonePe / Paytm (text).
  // The library reparents the activity on cold-start, remounting the tree 2–3×,
  // so the payload lands on a transient mount. Capture it into a module-level
  // stash the moment it appears, then flush to /add once the navigator is ready
  // (which may be a later mount entirely).
  useEffect(() => {
    if (hasShareIntent) {
      const pdf = shareIntent.files?.find(
        (f) => f.mimeType === 'application/pdf' || f.path?.toLowerCase().endsWith('.pdf'),
      );
      const image = shareIntent.files?.find((f) => f.mimeType?.startsWith('image/'));
      const chatgpt = chatgptShareLink(shareIntent.text);
      if (pdf?.path) shareStore.pending = { pdfUri: pdf.path, pdfName: pdf.fileName ?? undefined };
      else if (image?.path) shareStore.pending = { imageUri: image.path };
      else if (chatgpt) shareStore.pending = { chatgptUrl: chatgpt };
      else if (shareIntent.text) shareStore.pending = { text: shareIntent.text };
      if (shareStore.pending) resetShareIntent();
    }
    if (navState?.key && shareStore.pending) {
      const p = shareStore.pending;
      shareStore.pending = null;
      // A bank-statement PDF → reconcile; a ChatGPT share link → flashcards; else a payment → /add.
      if (p.pdfUri) {
        router.push({ pathname: '/statement-import', params: { uri: p.pdfUri, name: p.pdfName ?? '' } });
      } else if (p.chatgptUrl) {
        router.push({ pathname: '/flashcard-import', params: { url: p.chatgptUrl } });
      } else {
        router.push({
          pathname: '/add',
          params: { source: 'shared', ...(p.imageUri ? { imageUri: p.imageUri } : { text: p.text ?? '' }) },
        });
      }
    }
  }, [hasShareIntent, navState?.key, shareIntent]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: true,
            headerStyle: { backgroundColor: '#000000' },
            headerTintColor: '#F4F5F9',
            headerTitleStyle: { fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: '#000000' },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ title: 'Setup' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction' }} />
          <Stack.Screen name="classify/[id]" options={{ title: 'Classify', presentation: 'modal' }} />
          <Stack.Screen name="add" options={{ title: 'Add spend', presentation: 'modal' }} />
          <Stack.Screen name="review" options={{ title: 'Needs review' }} />
          <Stack.Screen name="categories" options={{ title: 'Categories' }} />
          <Stack.Screen name="reports" options={{ title: 'Reports' }} />
          <Stack.Screen name="report/[id]" options={{ title: 'Report' }} />
          <Stack.Screen name="mandates" options={{ title: 'Mandates & EMIs' }} />
          <Stack.Screen name="rules" options={{ title: 'Classification rules' }} />
          <Stack.Screen name="gate" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
          <Stack.Screen name="focus" options={{ title: 'Focus' }} />
          <Stack.Screen name="statements" options={{ title: 'Statements' }} />
          <Stack.Screen name="statement/[id]" options={{ title: 'Reconcile' }} />
          <Stack.Screen name="statement-import" options={{ title: 'Importing…', presentation: 'modal' }} />
          <Stack.Screen name="flashcard-import" options={{ title: 'New flashcards', presentation: 'modal' }} />
        </Stack>
        {/* Lock overlays — on top of the Stack, tree stays mounted underneath. */}
        {checking && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }} />}
        {locked && <LockScreen onUnlock={() => setLocked(false)} />}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ debug: true, resetOnBackground: false }}>
      <AppShell />
    </ShareIntentProvider>
  );
}
