import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, Alert } from 'react-native';
import { createManualRule, fetchRules, deleteRuleAPI, RuleRow } from '../src/api/client';
import { Button, Card, colors, H2, Loading, Muted, Screen, CategoryPill } from '../src/ui';
import { useCategories } from '../src/hooks';

export default function RulesScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['rules'], queryFn: fetchRules });
  const [pattern, setPattern] = useState('');
  const categories = useCategories();
  const [category, setCategory] = useState<string | null>(null);

  async function add() {
    if (!pattern.trim() || !category) return;
    await createManualRule(pattern.trim(), category);
    setPattern('');
    setCategory(null);
    qc.invalidateQueries({ queryKey: ['rules'] });
  }

  async function remove(id: string) {
    Alert.alert('Delete rule', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteRuleAPI(id);
          qc.invalidateQueries({ queryKey: ['rules'] });
        },
      },
    ]);
  }

  return (
    <Screen>
      <Card>
        <H2>Add manual rule</H2>
        <View style={{ height: 8 }} />
        <TextInput
          value={pattern}
          onChangeText={setPattern}
          placeholder="Merchant pattern (e.g. Netflix)"
          placeholderTextColor={colors.sub}
          style={styles.input}
        />
        <View style={{ height: 10 }} />
        <View style={styles.pills}>
          {categories.map((c) => (
            <CategoryPill key={c} name={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <View style={{ height: 10 }} />
        <Button title="Add Rule" onPress={add} disabled={!pattern.trim() || !category} />
      </Card>

      <Card>
        <H2>Classification rules</H2>
        <View style={{ height: 6 }} />
        {isLoading ? (
          <Loading />
        ) : (
          (data ?? []).map((r: RuleRow) => (
            <View key={r.id} style={styles.row}>
              <View style={styles.info}>
                <Text style={styles.pattern}>{r.pattern}</Text>
                <Text style={styles.category}>{r.category}</Text>
              </View>
              <View style={styles.meta}>
                <View style={[styles.badge, r.source === 'learned' ? styles.badgeLearned : styles.badgeManual]}>
                  <Text style={styles.badgeText}>{r.source}</Text>
                </View>
                <Muted style={styles.hits}>{r.hit_count} hits</Muted>
              </View>
              <Button title="Delete" variant="ghost" onPress={() => remove(r.id)} />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: colors.text,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  info: { flex: 1 },
  pattern: { color: colors.text, fontSize: 16, fontWeight: '500' },
  category: { color: colors.sub, fontSize: 13, marginTop: 2 },
  meta: { alignItems: 'flex-end', marginRight: 12 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginBottom: 4 },
  badgeLearned: { backgroundColor: colors.surface3 },
  badgeManual: { backgroundColor: colors.surface2 },
  badgeText: { color: colors.text, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  hits: { fontSize: 11 },
});
