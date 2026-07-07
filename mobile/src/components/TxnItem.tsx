import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TxnRow } from '../api/client';
import { categoryLight, categoryTint, formatNum } from '../config';
import { timeOrDay } from '../dates';
import { colors } from '../ui';

/**
 * One ledger row: merchant-initial tile tinted by category, name over
 * `category · when`, amount right-aligned in tabular numerals. Debits stay ink;
 * only credits get color (green) — matches the AMOLED design.
 */
export function TxnItem({ txn, divider }: { txn: TxnRow; divider?: boolean }) {
  const when = timeOrDay(txn.occurred_at ?? txn.created_at);
  const debit = txn.direction === 'debit';
  const initial = (txn.merchant ?? '?').trim().charAt(0).toUpperCase() || '?';
  const needsReview = !txn.corrected && txn.confidence < 0.5;

  return (
    <Pressable
      onPress={() => router.push(`/transaction/${txn.id}`)}
      style={[styles.row, divider && styles.divider]}
    >
      <View style={[styles.tile, { backgroundColor: categoryTint(txn.category) }]}>
        <Text style={[styles.tileText, { color: categoryLight(txn.category) }]}>{initial}</Text>
      </View>
      <View style={styles.who}>
        <Text style={styles.merchant} numberOfLines={1}>
          {txn.merchant ?? 'Unknown'}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {txn.category} · {when}
          {needsReview ? ' · needs review' : ''}
        </Text>
      </View>
      <Text style={[styles.amt, { color: debit ? colors.text : colors.pos }]}>
        {debit ? '−' : '+'}₹{formatNum(txn.amount)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  tile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { fontSize: 14, fontWeight: '800' },
  who: { flex: 1, minWidth: 0 },
  merchant: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  sub: { color: colors.ghost, fontSize: 11, marginTop: 1 },
  amt: {
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
});
