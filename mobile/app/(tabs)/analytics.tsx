import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G } from 'react-native-svg';
import { AppHeader } from '../../src/components/AppHeader';
import { categoryColor, categoryShort, formatNum } from '../../src/config';
import { monthRange } from '../../src/dates';
import { useSummary } from '../../src/hooks';
import { Card, colors, Kicker, Loading, Money, Muted, SectionLabel } from '../../src/ui';

const SIZE = 128;
const R = 48;
const STROKE = 30;
const C = 2 * Math.PI * R;

function Donut({ slices, total }: { slices: { category: string; total: number }[]; total: number }) {
  let acc = 0;
  return (
    <View style={{ width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE}>
        <G rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`}>
          {/* track */}
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={colors.surface2} strokeWidth={STROKE} fill="none" />
          {slices.map((s) => {
            const frac = total > 0 ? s.total / total : 0;
            const seg = (
              <Circle
                key={s.category}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                stroke={categoryColor(s.category)}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={`${frac * C} ${C}`}
                strokeDashoffset={-acc * C}
              />
            );
            acc += frac;
            return seg;
          })}
        </G>
      </Svg>
      <View style={styles.donutCenter}>
        <Money value={total} size={16} />
        <Kicker style={{ marginTop: 2, fontSize: 8.5 }}>Spent</Kicker>
      </View>
    </View>
  );
}

export default function Analytics() {
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => monthRange(offset), [offset]);
  const { data, isLoading } = useSummary({ from: range.from, to: range.to });

  const total = data?.totalSpent ?? 0;
  const cats = data?.byCategory ?? [];
  const merchants = data?.topMerchants ?? [];
  const maxMerchant = merchants[0]?.total ?? 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <AppHeader title="Insights" meta="llm-classified" />

        <View style={styles.mnav}>
          <Pressable onPress={() => setOffset((o) => o - 1)} style={styles.nb} hitSlop={6}>
            <Text style={styles.nbText}>‹</Text>
          </Pressable>
          <Text style={styles.mLabel}>{range.label}</Text>
          <Pressable
            onPress={() => setOffset((o) => Math.min(0, o + 1))}
            style={[styles.nb, offset === 0 && { opacity: 0.35 }]}
            hitSlop={6}
          >
            <Text style={styles.nbText}>›</Text>
          </Pressable>
        </View>

        {isLoading ? (
          <Loading />
        ) : (
          <>
            <Card>
              {cats.length === 0 ? (
                <Muted>No data for this month.</Muted>
              ) : (
                <View style={styles.donutWrap}>
                  <Donut slices={cats} total={total} />
                  <View style={styles.dlegend}>
                    {cats.slice(0, 6).map((c) => {
                      const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
                      return (
                        <View key={c.category} style={styles.dleg}>
                          <View style={[styles.dlegDot, { backgroundColor: categoryColor(c.category) }]} />
                          <Text style={styles.dlegName} numberOfLines={1}>{categoryShort(c.category)}</Text>
                          <Text style={styles.dlegPct}>{pct}%</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </Card>

            <SectionLabel title="Top merchants" />
            <Card style={{ paddingVertical: 8 }}>
              {merchants.length === 0 ? (
                <Muted style={{ paddingVertical: 8 }}>No data.</Muted>
              ) : (
                merchants.map((m, i) => (
                  <View key={m.merchant} style={[styles.mrow, i > 0 && styles.mrowDivider]}>
                    <View style={styles.mtop}>
                      <Text style={styles.mname} numberOfLines={1}>{m.merchant}</Text>
                      <Text style={styles.mval}>₹{formatNum(m.total)} · {m.count}×</Text>
                    </View>
                    <View style={styles.mbar}>
                      <View style={[styles.mfill, { width: `${Math.max(4, Math.round((m.total / maxMerchant) * 100))}%` }]} />
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mnav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  nb: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nbText: { color: colors.sub, fontSize: 15, lineHeight: 18 },
  mLabel: { color: colors.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  donutWrap: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  donutCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dlegend: { flex: 1, gap: 7 },
  dleg: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dlegDot: { width: 8, height: 8, borderRadius: 2.5 },
  dlegName: { color: colors.sub, fontSize: 11.5, flex: 1 },
  dlegPct: { color: colors.text, fontSize: 11.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mrow: { paddingVertical: 9, gap: 4 },
  mrowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  mtop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  mname: { color: colors.text, fontSize: 12.5, fontWeight: '600', flex: 1 },
  mval: { color: colors.sub, fontSize: 12, fontVariant: ['tabular-nums'] },
  mbar: { height: 5, borderRadius: 3, backgroundColor: colors.surface2, overflow: 'hidden' },
  mfill: { height: '100%', borderRadius: 3, backgroundColor: colors.accent },
});
