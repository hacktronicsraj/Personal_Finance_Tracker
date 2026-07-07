import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TxnRow } from '../../src/api/client';
import { AppHeader } from '../../src/components/AppHeader';
import { TxnItem } from '../../src/components/TxnItem';
import { CATEGORIES, categoryShort } from '../../src/config';
import { dayLabel } from '../../src/dates';
import { useTransactions } from '../../src/hooks';
import { Card, colors, inputStyle, Loading, mono, Muted } from '../../src/ui';

function groupByDay(txns: TxnRow[]): { title: string; data: TxnRow[] }[] {
  const groups: { title: string; data: TxnRow[] }[] = [];
  for (const t of txns) {
    const title = dayLabel(t.occurred_at ?? t.created_at);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.data.push(t);
    else groups.push({ title, data: [t] });
  }
  return groups;
}

export default function Transactions() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const { data, isLoading, refetch, isFetching } = useTransactions({ category, q: q || undefined });

  const groups = useMemo(() => groupByDay(data ?? []), [data]);
  const count = data?.length ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ paddingHorizontal: 16 }}>
        <AppHeader title="Activity" meta={count ? `${count} txns` : undefined} />
        <TextInput
          placeholder="⌕  Search merchant or SMS…"
          placeholderTextColor={colors.ghost}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => refetch()}
          style={[inputStyle, { backgroundColor: colors.surface }]}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 7, paddingVertical: 10 }}
        >
          <FilterChip label="All" on={!category} onPress={() => setCategory(undefined)} />
          {CATEGORIES.map((c) => (
            <FilterChip key={c} label={categoryShort(c)} on={category === c} onPress={() => setCategory(c)} />
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.title}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 4 }}
          onRefresh={refetch}
          refreshing={isFetching}
          ListEmptyComponent={
            <View style={{ padding: 24 }}>
              <Muted>No transactions match.</Muted>
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
    </SafeAreaView>
  );
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Text onPress={onPress} style={[styles.f, on && styles.fOn]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 11,
    fontWeight: '600',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#23242E',
    color: colors.sub,
    overflow: 'hidden',
  },
  fOn: {
    backgroundColor: colors.text,
    borderColor: colors.text,
    color: '#0A0A0D',
  },
});
