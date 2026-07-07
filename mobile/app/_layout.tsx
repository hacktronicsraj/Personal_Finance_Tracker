import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { updateCategory } from '../src/api/client';
import { unregisterReconcileTask } from '../src/background';
import { setLocalCategory } from '../src/db/database';
import { configureNotifications } from '../src/notify/notifications';
import { ingestSms, syncBackend } from '../src/sms/ingest';
import { startSmsListener } from '../src/sms/reader';

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

  const txnId = (req.content.data as { txnId?: string })?.txnId;
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

  useEffect(() => {
    configureNotifications().catch(() => {});
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
    syncBackend().catch(() => {});
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncBackend().catch(() => {});
    });

    return () => {
      sub.remove();
      appSub.remove();
    };
  }, []);

  // A payment shared from Google Pay (screenshot) / PhonePe / Paytm (text) →
  // open the confirm screen prefilled from the image or text.
  useEffect(() => {
    if (!hasShareIntent) return;
    const image = shareIntent.files?.find((f) => f.mimeType?.startsWith('image/'));
    if (image?.path) {
      router.push({ pathname: '/add', params: { imageUri: image.path, source: 'shared' } });
    } else if (shareIntent.text) {
      router.push({ pathname: '/add', params: { text: shareIntent.text, source: 'shared' } });
    }
    resetShareIntent();
  }, [hasShareIntent]);

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
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider>
      <AppShell />
    </ShareIntentProvider>
  );
}
