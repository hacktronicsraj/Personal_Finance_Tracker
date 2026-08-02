import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TxnFilters, TxnRow } from '../../src/api/client';
import { AppHeader } from '../../src/components/AppHeader';
import { CloseIcon, FilterIcon, SearchIcon } from '../../src/components/icons';
import { TxnItem } from '../../src/components/TxnItem';
import { categoryShort, formatNum } from '../../src/config';
import { dayLabel, monthRange } from '../../src/dates';
import { useAllTags, useCategories, useTransactions } from '../../src/hooks';
import { Button, Card, colors, inputStyle, Loading, mono, Muted, ripple } from '../../src/ui';

type DatePreset = 'all' | 'thisMonth' | 'lastMonth' | 'last90';

const SOURCES: { key: string; label: string }[] = [
  { key: 'sms', label: 'SMS' },
  { key: 'shared', label: 'Shared' },
  { key: 'manual', label: 'Manual' },
];

interface Filters {
  categories: string[];
  datePreset: DatePreset;
  minAmount?: number;
  maxAmount?: number;
  source?: string;
  tag?: string;
}

const EMPTY: Filters = { categories: [], datePreset: 'all' };

const PRESET_LABEL: Record<DatePreset, string> = {
  all: 'All time',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last90: 'Last 90 days',
};

function dateRange(p: DatePreset): { from?: string; to?: string } {
  if (p === 'thisMonth') { const r = monthRange(0); return { from: r.from, to: r.to }; }
  if (p === 'lastMonth') { const r = monthRange(-1); return { from: r.from, to: r.to }; }
  if (p === 'last90') {
    const now = new Date();
    return { from: new Date(now.getTime() - 90 * 86400000).toISOString(), to: now.toISOString() };
  }
  return {};
}

/** Map the UI filter state to the query params the hook/server understand. */
function toQuery(f: Filters, q: string): TxnFilters {
  return {
    q: q || undefined,
    categories: f.categories.length ? f.categories : undefined,
    ...dateRange(f.datePreset),
    minAmount: f.minAmount,
    maxAmount: f.maxAmount,
    source: f.source,
    tag: f.tag,
  };
}

function activeCount(f: Filters): number {
  return (
    (f.datePreset !== 'all' ? 1 : 0) +
    f.categories.length +
    (f.minAmount != null || f.maxAmount != null ? 1 : 0) +
    (f.source ? 1 : 0) +
    (f.tag ? 1 : 0)
  );
}

function groupByDay(txns: TxnRow[]): { title: string; data: TxnRow[] }[] {
  const groups: { title: string; data: TxnRow[] }[] = [];
  for (const t of txns) {
    // Group by the recorded day (created_at) so headers stay contiguous and unique
    // under the created_at sort — a back-dated entry groups under the day it was
    // logged, not its (older) transaction date. Each row still shows its txn time.
    const title = dayLabel(t.created_at);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.data.push(t);
    else groups.push({ title, data: [t] });
  }
  return groups;
}

export default function Transactions() {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sheetOpen, setSheetOpen] = useState(false);

  const query = useMemo(() => toQuery(filters, q), [filters, q]);
  const { data, isLoading, refetch, isFetching } = useTransactions(query);

  const groups = useMemo(() => groupByDay(data ?? []), [data]);
  const count = data?.length ?? 0;
  const nActive = activeCount(filters);

  // Descriptors for the active-filter chip row (each removable independently).
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.datePreset !== 'all')
    chips.push({ key: 'date', label: PRESET_LABEL[filters.datePreset], clear: () => setFilters((f) => ({ ...f, datePreset: 'all' })) });
  for (const c of filters.categories)
    chips.push({ key: `cat:${c}`, label: categoryShort(c), clear: () => setFilters((f) => ({ ...f, categories: f.categories.filter((x) => x !== c) })) });
  if (filters.minAmount != null || filters.maxAmount != null) {
    const lo = filters.minAmount != null ? `₹${formatNum(filters.minAmount)}` : '';
    const hi = filters.maxAmount != null ? `₹${formatNum(filters.maxAmount)}` : '';
    const label = lo && hi ? `${lo}–${hi}` : lo ? `≥${lo}` : `≤${hi}`;
    chips.push({ key: 'amt', label, clear: () => setFilters((f) => ({ ...f, minAmount: undefined, maxAmount: undefined })) });
  }
  if (filters.source)
    chips.push({ key: 'src', label: SOURCES.find((s) => s.key === filters.source)?.label ?? filters.source, clear: () => setFilters((f) => ({ ...f, source: undefined })) });
  if (filters.tag)
    chips.push({ key: 'tag', label: `#${filters.tag}`, clear: () => setFilters((f) => ({ ...f, tag: undefined })) });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 16 }}>
        <AppHeader title="Activity" meta={count ? `${count} txns` : undefined} />
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <SearchIcon size={15} />
            <TextInput
              placeholder="Search merchant or SMS…"
              placeholderTextColor={colors.ghost}
              value={q}
              onChangeText={setQ}
              onSubmitEditing={() => refetch()}
              accessibilityLabel="Search transactions"
              style={styles.searchInput}
            />
          </View>
          <Pressable
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={nActive > 0 ? `Filters, ${nActive} active` : 'Filters'}
            android_ripple={ripple}
            style={({ pressed }) => [styles.filterBtn, nActive > 0 && styles.filterBtnOn, pressed && { opacity: 0.7 }]}
          >
            <FilterIcon size={16} color={nActive > 0 ? colors.onAccent : colors.sub} />
            {nActive > 0 && <Text style={[styles.filterBtnText, { color: colors.onAccent }]}>{nActive}</Text>}
          </Pressable>
        </View>

        {chips.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 10 }}>
            {chips.map((chip) => (
              <Pressable
                key={chip.key}
                onPress={chip.clear}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove filter ${chip.label}`}
                style={({ pressed }) => [styles.activeChip, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.activeChipText}>{chip.label}</Text>
                <CloseIcon size={11} color={colors.accent} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => setFilters(EMPTY)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
              style={({ pressed }) => [styles.clearAll, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.clearAllText}>Clear all</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.title}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: chips.length ? 0 : 10, gap: 4 }}
          onRefresh={refetch}
          refreshing={isFetching}
          ListEmptyComponent={
            <View style={{ padding: 24, alignItems: 'center', gap: 14 }}>
              <Muted style={{ textAlign: 'center' }}>
                {nActive > 0 || q
                  ? 'No transactions match these filters.'
                  : 'No transactions yet — they appear here as SMS alerts arrive.'}
              </Muted>
              {(nActive > 0 || q) && (
                <Button
                  title="Clear filters"
                  variant="ghost"
                  onPress={() => {
                    setFilters(EMPTY);
                    setQ('');
                  }}
                />
              )}
            </View>
          }
          renderItem={({ item: group }) => (
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.dategrp}>{group.title}</Text>
              <Card style={{ paddingVertical: 4 }}>
                {group.data.map((t, i) => (
                  <TxnItem key={t.id} txn={t} divider={i > 0} />
                ))}
              </Card>
            </View>
          )}
        />
      )}

      <FilterSheet
        open={sheetOpen}
        initial={filters}
        onClose={() => setSheetOpen(false)}
        onApply={(f) => {
          setFilters(f);
          setSheetOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

function FilterSheet({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: boolean;
  initial: Filters;
  onClose: () => void;
  onApply: (f: Filters) => void;
}) {
  const categories = useCategories();
  const tags = useAllTags();
  // Draft edits so the underlying list doesn't thrash until "Apply".
  const [draft, setDraft] = useState<Filters>(initial);
  const [minStr, setMinStr] = useState(initial.minAmount != null ? String(initial.minAmount) : '');
  const [maxStr, setMaxStr] = useState(initial.maxAmount != null ? String(initial.maxAmount) : '');
  // Re-seed the draft each time the sheet opens.
  const [seenOpen, setSeenOpen] = useState(false);
  if (open && !seenOpen) {
    setDraft(initial);
    setMinStr(initial.minAmount != null ? String(initial.minAmount) : '');
    setMaxStr(initial.maxAmount != null ? String(initial.maxAmount) : '');
    setSeenOpen(true);
  }
  if (!open && seenOpen) setSeenOpen(false);

  const toggleCat = (c: string) =>
    setDraft((d) => ({ ...d, categories: d.categories.includes(c) ? d.categories.filter((x) => x !== c) : [...d.categories, c] }));

  const apply = () => {
    const min = Number(minStr.replace(/[^\d.]/g, ''));
    const max = Number(maxStr.replace(/[^\d.]/g, ''));
    onApply({
      ...draft,
      minAmount: minStr && Number.isFinite(min) ? min : undefined,
      maxAmount: maxStr && Number.isFinite(max) ? max : undefined,
    });
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close filters"
      />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <ScrollView contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.sheetTitle}>Filters</Text>

          <Text style={styles.group}>Date</Text>
          <View style={styles.wrap}>
            {(Object.keys(PRESET_LABEL) as DatePreset[]).map((p) => (
              <Toggle key={p} label={PRESET_LABEL[p]} on={draft.datePreset === p} onPress={() => setDraft((d) => ({ ...d, datePreset: p }))} />
            ))}
          </View>

          <Text style={styles.group}>Amount (₹)</Text>
          <View style={styles.amtRow}>
            <TextInput value={minStr} onChangeText={setMinStr} keyboardType="decimal-pad" placeholder="Min" placeholderTextColor={colors.ghost} style={[inputStyle, styles.amtInput]} />
            <Text style={styles.amtDash}>–</Text>
            <TextInput value={maxStr} onChangeText={setMaxStr} keyboardType="decimal-pad" placeholder="Max" placeholderTextColor={colors.ghost} style={[inputStyle, styles.amtInput]} />
          </View>

          <Text style={styles.group}>Source</Text>
          <View style={styles.wrap}>
            {SOURCES.map((s) => (
              <Toggle key={s.key} label={s.label} on={draft.source === s.key} onPress={() => setDraft((d) => ({ ...d, source: d.source === s.key ? undefined : s.key }))} />
            ))}
          </View>

          {tags.length > 0 && (
            <>
              <Text style={styles.group}>Tag</Text>
              <View style={styles.wrap}>
                {tags.map((t) => (
                  <Toggle key={t} label={t} on={draft.tag === t} onPress={() => setDraft((d) => ({ ...d, tag: d.tag === t ? undefined : t }))} />
                ))}
              </View>
            </>
          )}

          <Text style={styles.group}>Categories</Text>
          <View style={styles.wrap}>
            {categories.map((c) => (
              <Toggle key={c} label={categoryShort(c)} on={draft.categories.includes(c)} onPress={() => toggleCat(c)} />
            ))}
          </View>
        </ScrollView>

        <View style={styles.sheetBar}>
          <Button title="Reset" variant="ghost" onPress={() => { setDraft(EMPTY); setMinStr(''); setMaxStr(''); }} />
          <View style={{ flex: 1 }}>
            <Button title="Apply" onPress={apply} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      android_ripple={ripple}
      style={({ pressed }) => [styles.f, on && styles.fOn, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.fText, on && styles.fTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 12 },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 14,
    height: 46,
    minWidth: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  filterBtnOn: { backgroundColor: colors.text, borderColor: colors.text },
  filterBtnText: { color: colors.sub, fontSize: 13, fontWeight: '700' },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.accentLine,
  },
  activeChipText: { color: colors.accent, fontSize: 11.5, fontWeight: '600' },
  clearAll: { justifyContent: 'center', paddingHorizontal: 6 },
  clearAllText: { color: colors.ghost, fontSize: 11.5, fontWeight: '600', textDecorationLine: 'underline' },
  dategrp: {
    fontFamily: mono,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: colors.ghost,
    textTransform: 'uppercase',
    marginBottom: 6,
    marginLeft: 2,
  },
  f: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#23242E',
    overflow: 'hidden',
  },
  fOn: { backgroundColor: colors.text, borderColor: colors.text },
  fText: { fontSize: 11.5, fontWeight: '600', color: colors.sub },
  fTextOn: { color: '#0A0A0D' },
  // Sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#23242E', alignSelf: 'center', marginBottom: 6 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 },
  group: {
    color: colors.ghost,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 9,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amtRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  amtInput: { flex: 1, backgroundColor: colors.bg },
  amtDash: { color: colors.ghost, fontSize: 16 },
  sheetBar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
});
