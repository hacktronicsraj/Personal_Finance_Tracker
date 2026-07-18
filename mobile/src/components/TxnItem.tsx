import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TxnRow } from '../api/client';
import { formatNum } from '../config';
import { timeOrDay } from '../dates';
import { colors, ripple } from '../ui';

/**
 * One ledger row: uniform monochrome initial tile (Ink), merchant over
 * `category · when`, amount right-aligned in tabular numerals. Debits stay ink;
 * only credits get the emerald accent.
 */
export function TxnItem({ txn, divider }: { txn: TxnRow; divider?: boolean }) {
  const when = timeOrDay(txn.occurred_at ?? txn.created_at);
  const debit = txn.direction === 'debit';
  const initial = (txn.merchant ?? '?').trim().charAt(0).toUpperCase() || '?';
  const needsReview = !txn.corrected && txn.confidence < 0.5;

  return (
    <Pressable
      onPress={() => router.push(`/transaction/${txn.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${txn.merchant ?? 'Unknown'}, ${debit ? 'spent' : 'received'} ₹${formatNum(txn.amount)}, ${txn.category}, ${when}`}
      android_ripple={ripple}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.tile}>
        <Text style={styles.tileText}>{initial}</Text>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  tileText: { color: colors.sub, fontSize: 15, fontWeight: '700' },
  who: { flex: 1, minWidth: 0 },
  merchant: { color: colors.text, fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
  sub: { color: colors.ghost, fontSize: 11.5, marginTop: 2 },
  amt: {
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
});
