import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { isConfigured } from '../src/settings';

export default function Index() {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    isConfigured().then(setReady).catch(() => setReady(false));
  }, []);

  if (ready === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={ready ? '/(tabs)' : '/onboarding'} />;
}
