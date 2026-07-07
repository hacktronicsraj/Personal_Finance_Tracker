import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { updateCategory } from '../../src/api/client';
import { CATEGORIES } from '../../src/config';
import { setLocalCategory } from '../../src/db/database';
import { useTransaction } from '../../src/hooks';
import { Button, Card, CategoryPill, Chip, colors, Loading, Money, Muted, Screen } from '../../src/ui';

/** Full classify sheet — opened from the notification's "Other…" action. */
export default function ClassifyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: txn, isLoading } = useTransaction(id);
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);

  const selected = picked ?? txn?.category ?? null;

  function save() {
    if (!txn || !selected) return;
    // Persist locally + fire the network write in the background, then close
    // immediately — no waiting on the round-trip.
    setLocalCategory(txn.id, selected).catch(() => {});
    updateCategory(txn.id, selected)
      .then(() => qc.invalidateQueries())
      .catch(() => {
        /* offline: local change stays, reconciles on next sync */
      });
    router.back();
  }

  if (isLoading) return <Screen><Loading /></Screen>;
  if (!txn) return <Screen><Muted>Transaction not found.</Muted></Screen>;

  const where = [txn.bank, txn.account_tail ? `··${txn.account_tail}` : null].filter(Boolean).join(' ');

  return (
    <Screen scroll={false}>
      <View style={styles.grabber} />
      <Text style={styles.title}>How would you classify this?</Text>

      <View style={styles.amountBlock}>
        <Money value={txn.amount} size={44} />
        <Text style={styles.who}>
          {txn.merchant ?? 'Unknown'}
          {where ? ` · ${where}` : ''}
        </Text>
        <View style={{ marginTop: 12 }}>
          <Chip
            label={`LLM guess: ${txn.category} · ${Math.round(txn.confidence * 100)}% sure`}
            bg="rgba(148,163,184,0.12)"
            color="#AAB1C2"
          />
        </View>
      </View>

      <Card style={{ marginTop: 16 }}>
        <View style={styles.pills}>
          {CATEGORIES.map((c) => (
            <CategoryPill key={c} name={c} selected={selected === c} onPress={() => setPicked(c)} />
          ))}
        </View>
      </Card>

      <Text style={styles.teach}>
        Your answer becomes a training example —{'\n'}the next similar payment gets guessed right.
      </Text>

      <Button
        title={selected ? `Save · ${selected}` : 'Pick a category'}
        onPress={save}
        disabled={!selected}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#23242E', alignSelf: 'center' },
  title: { color: colors.sub, fontSize: 12.5, textAlign: 'center', marginTop: 10 },
  amountBlock: { alignItems: 'center', marginTop: 10 },
  who: { color: colors.sub, fontSize: 14, marginTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  teach: {
    color: colors.ghost,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 'auto',
    marginBottom: 14,
  },
});
