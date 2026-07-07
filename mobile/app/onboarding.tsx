import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { health } from '../src/api/client';
import { configureNotifications } from '../src/notify/notifications';
import { requestSmsPermission, smsSupported } from '../src/sms/reader';
import { saveConnection } from '../src/settings';
import { Button, Card, colors, H1, H2, Muted, Screen } from '../src/ui';

export default function Onboarding() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (!url.trim()) {
      Alert.alert('Backend URL required', 'Enter the URL of your Cloudflare Worker.');
      return;
    }
    setBusy(true);
    try {
      await saveConnection(url.trim(), token.trim());
      // Verify connectivity (non-fatal).
      try {
        await health();
      } catch {
        Alert.alert('Heads up', 'Could not reach the backend yet — you can fix the URL later in Settings.');
      }
      await configureNotifications();
      if (smsSupported()) {
        const granted = await requestSmsPermission();
        if (!granted) {
          Alert.alert('SMS permission', 'Without SMS access the app can’t auto-capture live bank messages. You can still share screenshots and add spends manually, or grant it later in Settings.');
        }
      }
      router.replace('/(tabs)');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <H1>Finance Tracker</H1>
      <Muted>Reads your bank/UPI SMS, classifies each transaction with an LLM, and asks you to confirm the category.</Muted>

      <Card>
        <H2>Connect your backend</H2>
        <View style={{ height: 10 }} />
        <TextInput
          placeholder="https://pft.<you>.workers.dev"
          placeholderTextColor={colors.sub}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={url}
          onChangeText={setUrl}
          style={styles.input}
        />
        <View style={{ height: 8 }} />
        <TextInput
          placeholder="API token (optional)"
          placeholderTextColor={colors.sub}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={token}
          onChangeText={setToken}
          style={styles.input}
        />
      </Card>

      <Card>
        <H2>Permissions</H2>
        <Muted>On continue we request SMS + notification access. SMS text is only sent to your backend for classification; OTP messages are ignored.</Muted>
      </Card>

      <Button title={busy ? 'Setting up…' : 'Continue'} onPress={finish} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
});
