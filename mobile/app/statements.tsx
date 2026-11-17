import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  fetchStatements,
  type StatementSummary,
} from '../src/api/client';
import { AppHeader } from '../src/components/AppHeader';
import { pickStatementPdf } from '../src/statementCapture';
import { Button, Card, colors, Loading, Muted, Screen } from '../src/ui';

const fmtRange = (a: string, b: string) => {
  const f = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${f(a)} – ${f(b)}`;
};

export default function StatementsScreen() {
  const q = useQuery<StatementSummary[]>({ queryKey: ['statements'], queryFn: fetchStatements });
  const [busy, setBusy] = useState('');

  async function upload() {
    setBusy('Reading the PDF…');
    try {
      const detail = await pickStatementPdf((s) => setBusy(s));
      if (!detail) {
        setBusy('');
        return;
      }
      q.refetch();
      router.push(`/statement/${detail.statement.id}`);
    } catch (e: any) {
      Alert.alert('Could not read statement', String(e?.message ?? e));
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen>
      <AppHeader title="Statements" meta="reconcile" />
      <Card>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>Weekly reconciliation</Text>
        <Muted style={{ marginTop: 6 }}>
          Share your bank statement PDF to this app (or pick one below). I’ll match every line against your ledger and
          show you exactly what to add or remove — nothing changes until you approve it.
        </Muted>
        <View style={{ height: 12 }} />
        <Button title={busy || 'Upload a statement PDF'} onPress={upload} disabled={!!busy} />
      </Card>

      {q.isLoading ? (
        <Loading />
      ) : (q.data ?? []).length === 0 ? (
        <Muted style={{ textAlign: 'center', marginTop: 20 }}>No statements yet.</Muted>
      ) : (
        (q.data ?? []).map((s) => (
          <Pressable key={s.id} onPress={() => router.push(`/statement/${s.id}`)}>
            <Card style={{ paddingVertical: 14 }}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{s.bank ?? 'Statement'} {s.account_tail ? `····${s.account_tail}` : ''}</Text>
                  <Muted style={{ marginTop: 2 }}>{fmtRange(s.period_start, s.period_end)} · {s.debit_count} debits</Muted>
                </View>
                <View style={[styles.badge, { backgroundColor: s.status === 'applied' ? colors.accentDim : colors.amberDim }]}>
                  <Text style={{ color: s.status === 'applied' ? colors.accent : colors.amber, fontSize: 11, fontWeight: '700' }}>
                    {s.status === 'applied' ? `+${s.added} −${s.removed}` : 'review'}
                  </Text>
                </View>
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
});
