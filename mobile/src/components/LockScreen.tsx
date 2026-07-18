import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { hasPin, verifyPin } from '../lock';
import { colors, mono } from '../ui';
import { BackspaceIcon, FingerprintIcon } from './icons';

/**
 * Full-screen lock overlay. Prompts for biometric on mount; falls back to a
 * 4-digit PIN when biometrics aren't enrolled or fail (and a PIN is set). Calls
 * onUnlock once either succeeds. Rendered ON TOP of the app tree (not replacing
 * it) so the share-intent stash and navigator stay mounted underneath.
 */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState('');
  const [pinAvailable, setPinAvailable] = useState(false);
  const [error, setError] = useState('');

  const runBiometric = useCallback(async () => {
    setError('');
    const pinSet = await hasPin();
    setPinAvailable(pinSet);
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();

    if (hw && enrolled) {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Finance Tracker',
        // We provide our own PIN fallback, so suppress the OS device-PIN sheet.
        disableDeviceFallback: pinSet,
        cancelLabel: pinSet ? 'Use PIN' : undefined,
      });
      if (res.success) return onUnlock();
      if (pinSet) setPinMode(true);
      else setError('Authentication failed — try again.');
    } else if (pinSet) {
      setPinMode(true);
    } else {
      // No biometric enrolled and no PIN set — nothing to check against; don't
      // trap the user out of their own app.
      onUnlock();
    }
  }, [onUnlock]);

  useEffect(() => {
    runBiometric();
  }, [runBiometric]);

  const press = async (digit: string) => {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError('');
    if (next.length === 4) {
      if (await verifyPin(next)) onUnlock();
      else {
        setError('Wrong PIN');
        setPin('');
      }
    }
  };

  const del = () => setPin((p) => p.slice(0, -1));

  return (
    <View style={styles.root}>
      <Text style={styles.brand}>Finance Tracker</Text>
      {pinMode ? (
        <>
          <Text style={styles.prompt}>Enter your PIN</Text>
          <View style={styles.dots}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]} />
            ))}
          </View>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.pad}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Key key={d} a11y={`Digit ${d}`} onPress={() => press(d)}>
                <Text style={styles.keyText}>{d}</Text>
              </Key>
            ))}
            {pinAvailable && (
              <Key a11y="Delete last digit" onPress={del}>
                <BackspaceIcon size={23} />
              </Key>
            )}
            <Key a11y="Digit 0" onPress={() => press('0')}>
              <Text style={styles.keyText}>0</Text>
            </Key>
            <Key a11y="Use fingerprint or face unlock" onPress={runBiometric}>
              <FingerprintIcon size={23} />
            </Key>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.prompt}>Locked</Text>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
            onPress={runBiometric}
            accessibilityRole="button"
            accessibilityLabel="Unlock"
          >
            <Text style={styles.retryText}>Unlock</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function Key({ children, a11y, onPress }: { children: React.ReactNode; a11y: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.key, pressed && { backgroundColor: colors.surface2 }]}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    paddingHorizontal: 32,
  },
  brand: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, marginBottom: 40 },
  prompt: { color: colors.sub, fontSize: 14, fontWeight: '600', marginBottom: 20 },
  dots: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.hairline2 },
  dotOn: { backgroundColor: colors.text, borderColor: colors.text },
  error: { color: colors.neg, fontSize: 12.5, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 264, justifyContent: 'center', gap: 12, marginTop: 24 },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  keyText: { color: colors.text, fontSize: 26, fontWeight: '600', fontFamily: mono },
  retry: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 16,
    backgroundColor: colors.text,
  },
  retryText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },
});
