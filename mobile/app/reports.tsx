import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchReports, generateReport, type ReportMeta } from '../src/api/client';
import { ChevronRightIcon } from '../src/components/icons';
import { formatINR } from '../src/config';
import { Button, Card, Chip, colors, Loading, Muted, ripple, Screen } from '../src/ui';

function label(r: ReportMeta): string {
  try {
    const s = JSON.parse(r.summary_json ?? '{}');
    if (s.label) return s.label as string;
  } catch {
    /* fall through */
  }
  const f = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${f(r.period_start)} – ${f(r.period_end)}`;
}

function total(r: ReportMeta): number | null {
  try {
    const s = JSON.parse(r.summary_json ?? '{}');
    return typeof s.total === 'number' ? s.total : null;
  } catch {
    return null;
  }
}

/** The last `n` calendar months as picker chips: [{label:'July', offset:0}, …] */
function monthChips(n: number): { label: string; offset: number }[] {
  const now = new Date();
  return Array.from({ length: n }, (_, offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = d.getFullYear() !== now.getFullYear() ? ` ’${String(d.getFullYear()).slice(2)}` : '';
    return { label: d.toLocaleDateString('en-IN', { month: 'long' }) + year, offset };
  });
}

export default function Reports() {
  const [items, setItems] = useState<ReportMeta[] | null>(null);
  const [generating, setGenerating] = useState<number | null>(null); // offset being generated
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchReports().then(setItems).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function genMonthly(offset: number) {
    if (generating !== null) return;
    setGenerating(offset);
    setError('');
    try {
      const report = await generateReport('monthly', offset);
      load();
      router.push(`/report/${report.id}`);
    } catch {
      setError('Could not generate — check your connection and try again.');
    } finally {
      setGenerating(null);
    }
  }

  return (
    <Screen>
      <Button title="View latest report" onPress={() => router.push('/report/latest')} />

      <Card>
        <Text style={styles.cardLabel}>Monthly report</Text>
        <Muted>Pick a month to generate (or refresh) its report.</Muted>
        <View style={styles.chips}>
          {monthChips(6).map((m) => (
            <Pressable
              key={m.offset}
              onPress={() => genMonthly(m.offset)}
              disabled={generating !== null}
              accessibilityRole="button"
              accessibilityLabel={`Generate report for ${m.label}`}
              accessibilityState={{ disabled: generating !== null }}
              android_ripple={ripple}
              style={({ pressed }) => [styles.mchip, (pressed || (generating !== null && generating !== m.offset)) && { opacity: 0.5 }]}
            >
              {generating === m.offset ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Text style={styles.mchipText}>{m.label}</Text>
              )}
            </Pressable>
          ))}
        </View>
        {!!error && <Muted style={{ marginTop: 8, color: colors.neg }}>{error}</Muted>}
      </Card>

      <Muted>Weekly digests are generated every Sunday evening; monthly ones on the 1st.</Muted>

      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Card>
          <Muted>No reports yet — your first weekly one arrives this Sunday.</Muted>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {items.map((r, i) => {
            const t = total(r);
            const monthly = r.period_type === 'monthly';
            return (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/report/${r.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${monthly ? 'Monthly' : 'Weekly'} report, ${label(r)}${t != null ? `, total ${formatINR(t)}` : ''}`}
                android_ripple={ripple}
                style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.week} numberOfLines={1}>{label(r)}</Text>
                  <View style={{ marginTop: 3, flexDirection: 'row' }}>
                    <Chip
                      label={monthly ? 'MONTHLY' : 'WEEKLY'}
                      bg={monthly ? colors.accentDim : colors.surface2}
                      color={monthly ? colors.accent : colors.sub}
                    />
                  </View>
                </View>
                <View style={styles.right}>
                  {t != null && <Text style={styles.total}>{formatINR(t)}</Text>}
                  <ChevronRightIcon size={15} color={colors.ghost} />
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardLabel: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  mchip: {
    minHeight: 38,
    minWidth: 74,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline2,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  mchipText: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 12, paddingHorizontal: 2 },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  week: { color: colors.text, fontSize: 14, fontWeight: '600' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  total: { color: colors.sub, fontSize: 13, fontVariant: ['tabular-nums'] },
});
