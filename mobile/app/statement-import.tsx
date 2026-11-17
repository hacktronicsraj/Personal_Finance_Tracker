import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { processStatementPdf } from '../src/statementCapture';
import { Button, colors, Muted } from '../src/ui';

/**
 * Lands here when a bank-statement PDF is shared to the app. Extracts the text on
 * device, reconciles it on the backend, then replaces itself with the review
 * screen. Password-protected PDFs prompt inline (handled in processStatementPdf).
 */
export default function StatementImport() {
  const { uri, name } = useLocalSearchParams<{ uri: string; name?: string }>();
  const [status, setStatus] = useState('Reading the PDF…');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !uri) return;
    started.current = true;
    processStatementPdf(String(uri), name ? String(name) : undefined, setStatus)
      .then((detail) => {
        if (detail) router.replace(`/statement/${detail.statement.id}`);
        else router.back(); // cancelled at the password prompt
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, [uri, name]);

  return (
    <SafeAreaView style={styles.screen}>
      {error ? (
        <View style={{ alignItems: 'center', gap: 16, padding: 24 }}>
          <Text style={{ fontSize: 40 }}>🧾</Text>
          <Muted style={{ textAlign: 'center' }}>{error}</Muted>
          <Button title="Close" variant="ghost" onPress={() => router.back()} />
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: 16 }}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{status}</Text>
          <Muted>Your statement stays on the phone — only its text is sent.</Muted>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
