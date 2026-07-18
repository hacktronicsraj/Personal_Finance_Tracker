import { Redirect } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { isConfigured } from '../src/settings';
import { shareStore } from '../src/shareStore';

export default function Index() {
  const [ready, setReady] = useState<boolean | null>(null);
  const { hasShareIntent } = useShareIntentContext();

  useEffect(() => {
    isConfigured().then(setReady).catch(() => setReady(false));
  }, []);

  // Hold on the initial redirect while a share is pending — the root layout
  // routes to /add once navigation is ready; redirecting to (tabs) here would
  // race and swallow the shared payment.
  if (hasShareIntent || shareStore.pending || ready === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={ready ? '/(tabs)' : '/onboarding'} />;
}
