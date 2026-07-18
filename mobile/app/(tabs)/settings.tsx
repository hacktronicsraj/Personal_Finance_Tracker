import { router, useFocusEffect } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Switch, Text, TextInput, View } from 'react-native';
import { health } from '../../src/api/client';
import { AppHeader } from '../../src/components/AppHeader';
import { countReviews } from '../../src/db/database';
import { monthRange } from '../../src/dates';
import { exportCsv } from '../../src/export';
import { clearPin, hasPin, isLockEnabled, setLockEnabled, setPin } from '../../src/lock';
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

  // App lock
  const [lockOn, setLockOn] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [pinModal, setPinModal] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setUrl(s.backendUrl);
      setToken(s.apiToken);
    });
    isLockEnabled().then(setLockOn).catch(() => {});
    hasPin().then(setPinSet).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      countReviews().then(setReviewCount).catch(() => {});
    }, []),
  );

  async function toggleLock(next: boolean) {
    if (!next) {
      await setLockEnabled(false);
      setLockOn(false);
      return;
    }
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (hw && enrolled) {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to enable app lock' });
      if (!res.success) {
        Alert.alert('Not enabled', 'Authentication was cancelled.');
        return;
      }
    } else if (!(await hasPin())) {
      Alert.alert('Set a PIN first', 'No biometrics are enrolled on this device. Set a 4-digit PIN to use as your app lock.');
      setPinModal(true);
      return;
    }
    await setLockEnabled(true);
    setLockOn(true);
  }

  async function savePin() {
    if (!/^\d{4}$/.test(pinDraft)) {
      Alert.alert('Invalid PIN', 'Enter exactly 4 digits.');
      return;
    }
    await setPin(pinDraft);
    setPinSet(true);
    setPinModal(false);
    setPinDraft('');
    setStatus('PIN saved.');
  }

  async function removePin() {
    await clearPin();
    setPinSet(false);
    setStatus('PIN removed.');
  }

  async function doExport(range?: { from?: string; to?: string }) {
    if (exporting) return;
    setExporting(true);
    setStatus('Preparing export…');
    try {
      await exportCsv(range);
      setStatus('Export ready.');
    } catch (e: any) {
      setStatus(`Export failed: ${e?.message ?? e}`);
    } finally {
      setExporting(false);
    }
  }

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
        <View style={{ height: 8 }} />
        <Button title="Classification rules" variant="ghost" onPress={() => router.push('/rules')} />
        <View style={{ height: 8 }} />
        <Button title="Mandates" variant="ghost" onPress={() => router.push('/mandates')} />
        <View style={{ height: 8 }} />
        <Button title="Reports" variant="ghost" onPress={() => router.push('/reports')} />
      </Card>

      <Card>
        <H2>Security</H2>
        <View style={{ height: 6 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>App lock</Text>
            <Muted style={{ marginTop: 2 }}>Require biometric or PIN on open and after 60s away.</Muted>
          </View>
          <Switch
            value={lockOn}
            onValueChange={toggleLock}
            accessibilityLabel="App lock"
            trackColor={{ true: colors.accent, false: colors.hairline2 }}
            thumbColor={colors.text}
          />
        </View>
        <View style={{ height: 10 }} />
        <Button
          title={pinSet ? 'Change PIN' : 'Set a 4-digit PIN'}
          variant="ghost"
          onPress={() => { setPinDraft(''); setPinModal(true); }}
        />
        {pinSet && (
          <>
            <View style={{ height: 8 }} />
            <Button title="Remove PIN" variant="ghost" onPress={removePin} />
          </>
        )}
      </Card>

      <Card>
        <H2>Export data</H2>
        <View style={{ height: 6 }} />
        <Muted>Download a CSV of your transactions (opens the share sheet). Doubles as a backup.</Muted>
        <View style={{ height: 10 }} />
        <Button title="This month" variant="ghost" onPress={() => { const r = monthRange(0); doExport({ from: r.from, to: r.to }); }} />
        <View style={{ height: 8 }} />
        <Button
          title="Last 3 months"
          variant="ghost"
          onPress={() => { const r = monthRange(-2); const now = monthRange(0); doExport({ from: r.from, to: now.to }); }}
        />
        <View style={{ height: 8 }} />
        <Button title="All time" variant="ghost" onPress={() => doExport()} />
      </Card>

      <Modal visible={pinModal} transparent animationType="fade" onRequestClose={() => setPinModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Card>
            <H2>{pinSet ? 'Change PIN' : 'Set PIN'}</H2>
            <View style={{ height: 8 }} />
            <Muted>Used when biometrics aren’t available.</Muted>
            <View style={{ height: 12 }} />
            <TextInput
              value={pinDraft}
              onChangeText={(t) => setPinDraft(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              maxLength={4}
              placeholder="••••"
              placeholderTextColor={colors.ghost}
              style={[inputStyle, { fontSize: 22, textAlign: 'center', letterSpacing: 8 }]}
            />
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button title="Cancel" variant="ghost" onPress={() => { setPinModal(false); setPinDraft(''); }} /></View>
              <View style={{ flex: 1 }}><Button title="Save" onPress={savePin} /></View>
            </View>
          </Card>
        </View>
      </Modal>

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
