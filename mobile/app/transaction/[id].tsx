import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { updateCategory } from '../../src/api/client';
import { CATEGORIES, formatINR } from '../../src/config';
import { setLocalCategory } from '../../src/db/database';
import { useTransaction } from '../../src/hooks';
import { Card, CategoryPill, Chip, colors, H2, Kicker, Loading, Money, Muted, Screen } from '../../src/ui';

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{String(value)}</Text>
    </View>
  );
}

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: txn, isLoading } = useTransaction(id);
  const qc = useQueryClient();
  // Optimistic selection — reflects the tap instantly, before the network write.
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function pick(category: string) {
    if (!txn) return;
    setPicked(category); // instant UI
    setConfirmed(true);
    setLocalCategory(txn.id, category).catch(() => {});
    // Network write + list/summary refresh happen in the background.
    updateCategory(txn.id, category)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['transactions'] });
        qc.invalidateQueries({ queryKey: ['summary'] });
      })
      .catch(() => {
        /* offline: local change stays, reconciles on next sync */
      });
  }

  if (isLoading) return <Screen><Loading /></Screen>;
  if (!txn) return <Screen><Muted>Transaction not found.</Muted></Screen>;

  const currentCategory = picked ?? txn.category;
  const isConfirmed = confirmed || !!txn.corrected;

  return (
    <Screen>
      <Card>
        <Kicker>{txn.direction === 'debit' ? 'Paid' : 'Received'}</Kicker>
        <View style={{ marginTop: 6 }}>
          <Money value={txn.amount} size={34} />
        </View>
        <Text style={styles.merchant}>{txn.merchant ?? 'Unknown'}</Text>
      </Card>

      <Card>
        <H2>Category</H2>
        <View style={{ marginTop: 6 }}>
          {isConfirmed ? (
            <Chip label="confirmed by you" bg="rgba(58,220,151,0.12)" color={colors.pos} />
          ) : (
            <Chip
              label={`LLM guess · ${Math.round(txn.confidence * 100)}% sure`}
              bg="rgba(148,163,184,0.12)"
              color="#AAB1C2"
            />
          )}
        </View>
        <View style={styles.pills}>
          {CATEGORIES.map((c) => (
            <CategoryPill key={c} name={c} selected={currentCategory === c} onPress={() => pick(c)} />
          ))}
        </View>
      </Card>

      <Card>
        <H2>Details</H2>
        <View style={{ height: 6 }} />
        <Field label="Bank" value={txn.bank} />
        <Field label="Account" value={txn.account_tail ? `··${txn.account_tail}` : null} />
        <Field label="Reference" value={txn.ref_no} />
        <Field label="Balance after" value={txn.balance != null ? formatINR(txn.balance) : null} />
        <Field label="Date" value={txn.occurred_at ? new Date(txn.occurred_at).toLocaleDateString('en-IN') : null} />
      </Card>

      <Card>
        <Kicker>Original SMS</Kicker>
        <Text style={styles.raw}>{txn.raw_text}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  merchant: { color: colors.sub, fontSize: 16, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  fieldLabel: { color: colors.ghost, fontSize: 13 },
  fieldValue: { color: colors.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  raw: { color: colors.sub, fontSize: 12.5, lineHeight: 19, marginTop: 8 },
});
