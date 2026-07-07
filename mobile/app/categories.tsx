import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { createCategory, fetchCategories } from '../src/api/client';
import { Button, Card, colors, H2, Loading, Muted, Screen } from '../src/ui';

export default function Categories() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: fetchCategories });
  const [name, setName] = useState('');

  async function add() {
    if (!name.trim()) return;
    await createCategory(name.trim());
    setName('');
    qc.invalidateQueries({ queryKey: ['categories'] });
  }

  return (
    <Screen>
      <Card>
        <H2>Add category</H2>
        <View style={{ height: 8 }} />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Rent"
          placeholderTextColor={colors.sub}
          style={styles.input}
        />
        <View style={{ height: 10 }} />
        <Button title="Add" onPress={add} />
      </Card>

      <Card>
        <H2>All categories</H2>
        <View style={{ height: 6 }} />
        {isLoading ? (
          <Loading />
        ) : (
          (data ?? []).map((c) => (
            <View key={c.id} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: c.color ?? '#94a3b8' }]} />
              <Text style={styles.name}>{c.name}</Text>
              {!!c.is_default && <Muted>default</Muted>}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { color: colors.text, fontSize: 15, flex: 1 },
});
