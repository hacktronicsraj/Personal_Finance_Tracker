import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchMandates, MandateRow } from '../../src/api/client';
import { AppHeader } from '../../src/components/AppHeader';
import { TxnItem } from '../../src/components/TxnItem';
import { categoryColor, formatNum } from '../../src/config';
import { monthRange } from '../../src/dates';
import { useSummary, useTransactions } from '../../src/hooks';
import { nextDueDate, formatDueDate, platformLabel } from '../../src/mandates';
import { Card, Chip, colors, Kicker, Loading, Money, Muted, SectionLabel } from '../../src/ui';

export default function Dashboard() {
  const range = useMemo(() => monthRange(0), []);
  const prevRange = useMemo(() => monthRange(-1), []);
  const summary = useSummary({ from: range.from, to: range.to });
  const prev = useSummary({ from: prevRange.from, to: prevRange.to });
  const txns = useTransactions();
  const mandatesQ = useQuery<MandateRow[]>({ queryKey: ['mandates'], queryFn: fetchMandates, staleTime: 5 * 60 * 1000 });

  const refreshing = summary.isFetching || txns.isFetching;
  const onRefresh = () => {
    summary.refetch();
    prev.refetch();
    txns.refetch();
    mandatesQ.refetch();
  };

  const total = summary.data?.totalSpent ?? 0;
  const cats = summary.data?.byCategory ?? [];
  const prevTotal = prev.data?.totalSpent ?? 0;
  const deltaPct = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  const recent = (txns.data ?? []).slice(0, 5);
  const needsReview = (txns.data ?? []).filter((t) => !t.corrected && t.confidence < 0.5).slice(0, 3);
  const syncedAt = txns.dataUpdatedAt
    ? new Date(txns.dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null;

  // Upcoming mandates (active, due within 7 days)
  const upcoming = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);
    return (mandatesQ.data ?? [])
      .filter((m) => m.active)
      .map((m) => ({ mandate: m, due: nextDueDate(m.day_of_cycle, m.frequency) }))
      .filter(({ due }) => due >= today && due <= weekAhead)
      .sort((a, b) => a.due.getTime() - b.due.getTime());
  }, [mandatesQ.data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <AppHeader title={range.monthName} meta={syncedAt ? `synced · ${syncedAt}` : undefined} />

        {/* Hero: one number rules the screen */}
        <Card>
          <Kicker>Spent this month</Kicker>
          <View style={{ marginTop: 6 }}>
            <Money value={total} size={40} />
          </View>
          {deltaPct !== null && (
            <View style={{ marginTop: 8 }}>
              <Chip
                label={`${deltaPct <= 0 ? '▼' : '▲'} ${Math.abs(deltaPct)}% vs ${prevRange.monthName}`}
                bg={deltaPct <= 0 ? 'rgba(58,220,151,0.12)' : colors.amberDim}
                color={deltaPct <= 0 ? colors.pos : colors.amber}
              />
            </View>
          )}

          {summary.isLoading ? (
            <Loading />
          ) : cats.length === 0 ? (
            <Muted style={{ marginTop: 12 }}>No spending yet this month.</Muted>
          ) : (
            <>
              {/* The month's shape: one stacked bar */}
              <View style={styles.stackbar}>
                {cats.map((c) => (
                  <View key={c.category} style={{ flex: c.total, backgroundColor: categoryColor(c.category) }} />
                ))}
              </View>
              <View style={styles.legend}>
                {cats.slice(0, 4).map((c) => {
                  const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
                  return (
                    <View key={c.category} style={styles.leg}>
                      <View style={[styles.legDot, { backgroundColor: categoryColor(c.category) }]} />
                      <Text style={styles.legName}>{c.category}</Text>
                      <Text style={styles.legVal}>₹{formatNum(c.total)} · {pct}%</Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </Card>

        {upcoming.length > 0 && (
          <>
            <SectionLabel title="Upcoming" action="Mandates →" onAction={() => router.push('/mandates')} />
            <Card style={{ paddingVertical: 6 }}>
              {upcoming.map(({ mandate: m, due }) => (
                <Pressable
                  key={m.id}
                  onPress={() => router.push('/mandates')}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name}, ₹${formatNum(m.amount)}, due ${formatDueDate(due)}`}
                  style={({ pressed }) => [styles.upcomingRow, pressed && { opacity: 0.55 }]}
                >
                  <View style={styles.upcomingTile}>
                    <Text style={styles.upcomingInitial}>{m.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.upcomingName} numberOfLines={1}>{m.name}</Text>
                    <Text style={styles.upcomingSub}>{platformLabel(m.platform)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.upcomingAmount}>₹{formatNum(m.amount)}</Text>
                    <Text style={[styles.upcomingDue, formatDueDate(due) === 'Today' && { color: colors.accent }]}>
                      {formatDueDate(due)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </Card>
          </>
        )}

        {needsReview.length > 0 && (
          <>
            <SectionLabel
              title={`Needs review · ${needsReview.length}`}
              action="See all"
              onAction={() => router.push('/(tabs)/transactions')}
            />
            <Card style={{ borderColor: 'rgba(245,158,11,0.35)', paddingVertical: 6 }}>
              {needsReview.map((t) => (
                <Pressable
                  key={t.id}
                  onPress={() => router.push(`/classify/${t.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Review ${t.merchant ?? 'unknown merchant'}, ₹${formatNum(t.amount)}, guessed ${t.category}`}
                  style={({ pressed }) => [styles.reviewRow, pressed && { opacity: 0.55 }]}
                >
                  <View style={styles.reviewTile}>
                    <Text style={styles.reviewInitial}>{(t.merchant ?? '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewName} numberOfLines={1}>{t.merchant ?? 'Unknown'}</Text>
                    <Text style={styles.reviewSub}>−₹{formatNum(t.amount)}</Text>
                  </View>
                  <Chip label={`guess: ${t.category}`} bg={colors.amberDim} color={colors.amber} />
                </Pressable>
              ))}
            </Card>
          </>
        )}

        <SectionLabel title="Recent" action="All →" onAction={() => router.push('/(tabs)/transactions')} />
        <Card style={{ paddingVertical: 4 }}>
          {txns.isLoading ? (
            <Loading />
          ) : recent.length === 0 ? (
            <Muted style={{ paddingVertical: 10 }}>No transactions yet. New bank SMS will appear here automatically.</Muted>
          ) : (
            recent.map((t, i) => <TxnItem key={t.id} txn={t} divider={i > 0} />)
          )}
        </Card>
      </ScrollView>

      {/* Quick add a spend without leaving Home. */}
      <Pressable
        onPress={() => router.push('/add')}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85, transform: [{ scale: 0.96 }] }]}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add a spend"
      >
        <Text style={styles.fabPlus}>+</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  stackbar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 14,
    backgroundColor: colors.surface2,
  },
  legend: { marginTop: 12, gap: 8 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legDot: { width: 9, height: 9, borderRadius: 3 },
  legName: { color: colors.text, fontSize: 12, fontWeight: '600', flex: 1 },
  legVal: { color: colors.ghost, fontSize: 11.5, fontVariant: ['tabular-nums'] },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  reviewTile: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  reviewInitial: { color: colors.sub, fontSize: 15, fontWeight: '700' },
  reviewName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  reviewSub: { color: colors.ghost, fontSize: 11.5, marginTop: 1, fontVariant: ['tabular-nums'] },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.text,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  fabPlus: { color: colors.bg, fontSize: 30, fontWeight: '700', lineHeight: 34, marginTop: -2 },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  upcomingTile: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  upcomingInitial: { color: colors.sub, fontSize: 14, fontWeight: '700' },
  upcomingName: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  upcomingSub: { color: colors.ghost, fontSize: 11, marginTop: 1 },
  upcomingAmount: { color: colors.text, fontSize: 13.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  upcomingDue: { color: colors.sub, fontSize: 10.5, fontWeight: '600', marginTop: 1 },
});
