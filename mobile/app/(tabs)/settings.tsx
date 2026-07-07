import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, TextInput, View } from 'react-native';
import { health } from '../../src/api/client';
import { AppHeader } from '../../src/components/AppHeader';
import { countReviews } from '../../src/db/database';
import { hasAutostartControls, openBatteryOptimization, openAutostartSettings } from '../../src/permissions';
import { pullSync } from '../../src/sms/ingest';
import { requestSmsPermission, smsSupported } from '../../src/sms/reader';
import { getSettings, saveConnection } from '../../src/settings';
import { Button, Card, colors, H2, inputStyle, Muted, Screen } from '../../src/ui';

export default function Settings() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    getSettings().then((s) => {
      setUrl(s.backendUrl);
      setToken(s.apiToken);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      countReviews().then(setReviewCount).catch(() => {});
    }, []),
  );

  async function save() {
    await saveConnection(url.trim(), token.trim());
    setStatus('Saved.');
  }
  async function test() {
    try {
      const h = await health();
      setStatus(`Backend OK (LLM mode: ${h.mode})`);
    } catch (e: any) {
      setStatus(`Failed: ${e?.message ?? e}`);
    }
  }
  async function sync() {
    const n = await pullSync();
    setStatus(`Synced ${n} change(s).`);
  }
  async function enableSms() {
    if (!smsSupported()) {
      Alert.alert('SMS not available', 'Needs a custom Android dev build.');
      return;
    }
    const ok = await requestSmsPermission();
    setStatus(ok ? 'Live SMS capture enabled.' : 'SMS permission denied — enable it in system settings.');
  }

  return (
    <Screen>
      <AppHeader title="Settings" />
      <Card>
        <H2>Backend</H2>
        <View style={{ height: 10 }} />
        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://pft.<you>.workers.dev"
          placeholderTextColor={colors.ghost}
          style={inputStyle}
        />
        <View style={{ height: 8 }} />
        <TextInput
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          secureTextEntry
          placeholder="API token"
          placeholderTextColor={colors.ghost}
          style={inputStyle}
        />
        <View style={{ height: 10 }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Save" onPress={save} /></View>
          <View style={{ flex: 1 }}><Button title="Test" variant="ghost" onPress={test} /></View>
        </View>
        {!!status && <Muted style={{ marginTop: 8 }}>{status}</Muted>}
      </Card>

      <Card>
        <H2>Capture</H2>
        <View style={{ height: 6 }} />
        <Muted>
          Share any payment from Google Pay / PhonePe / Paytm to Finance Tracker to log it. Bank SMS is also
          captured automatically in the background as a backstop.
        </Muted>
        <View style={{ height: 10 }} />
        <Button title="Add a spend manually" onPress={() => router.push('/add')} />
        <View style={{ height: 8 }} />
        <Button
          title={reviewCount > 0 ? `Review unread (${reviewCount})` : 'Review unread'}
          variant="ghost"
          onPress={() => router.push('/review')}
        />
      </Card>

      <Card>
        <H2>Background reliability</H2>
        <View style={{ height: 6 }} />
        <Muted>
          Android can kill background SMS capture to save power. Allow these so spends are caught even when the
          app is closed (this doesn’t drain the battery — capture is event-driven).
        </Muted>
        <View style={{ height: 10 }} />
        <Button title="Allow unrestricted battery" variant="ghost" onPress={openBatteryOptimization} />
        {hasAutostartControls() && (
          <>
            <View style={{ height: 8 }} />
            <Button title="Enable autostart" variant="ghost" onPress={openAutostartSettings} />
          </>
        )}
      </Card>

      <Card>
        <H2>Data</H2>
        <View style={{ height: 10 }} />
        <Button title="Sync now" variant="ghost" onPress={sync} />
        <View style={{ height: 8 }} />
        <Button title="Enable SMS capture" variant="ghost" onPress={enableSms} />
        <View style={{ height: 8 }} />
        <Button title="Manage categories" variant="ghost" onPress={() => router.push('/categories')} />
      </Card>

      <Card>
        <H2>About</H2>
        <View style={{ height: 6 }} />
        <Muted>
          Classification runs on your backend via an OpenAI-compatible model (configured at deploy time). Only messages
          detected as financial are sent; OTP messages are ignored. This build is for personal, sideloaded use.
        </Muted>
      </Card>
    </Screen>
  );
}
