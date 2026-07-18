import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  createMandate,
  deleteMandate,
  fetchMandates,
  MandateRow,
  patchMandate,
} from '../src/api/client';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { formatNum } from '../src/config';
import { useCategories } from '../src/hooks';
import { cycleLabel, formatDueDate, formatDueWithDate, nextDueDate, platformLabel, PLATFORMS } from '../src/mandates';
import { Button, Card, CategoryPill, colors, H2, inputStyle, Loading, Muted, Screen } from '../src/ui';

const FREQUENCIES = ['monthly', 'weekly', 'quarterly', 'yearly'] as const;

export default function MandatesScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['mandates'], queryFn: fetchMandates });
  const categories = useCategories();

  // ── form state ──
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dayOfCycle, setDayOfCycle] = useState('1');
  const [platform, setPlatform] = useState<MandateRow['platform']>('gpay');
  const [frequency, setFrequency] = useState<MandateRow['frequency']>('monthly');
  const [category, setCategory] = useState<string | null>(null);
  const [merchantHint, setMerchantHint] = useState('');
  const [notes, setNotes] = useState('');

  async function add() {
    if (!name.trim() || !amount.trim() || !category) return;
    await createMandate({
      name: name.trim(),
      amount: parseFloat(amount),
      day_of_cycle: parseInt(dayOfCycle, 10) || 1,
      platform,
      frequency,
      category,
      merchant_hint: merchantHint.trim() || null,
      notes: notes.trim() || null,
    });
    setName('');
    setAmount('');
    setDayOfCycle('1');
    setMerchantHint('');
    setNotes('');
    setCategory(null);
    qc.invalidateQueries({ queryKey: ['mandates'] });
  }

  async function toggle(m: MandateRow) {
    await patchMandate(m.id, { active: m.active ? 0 : 1 });
    qc.invalidateQueries({ queryKey: ['mandates'] });
  }

  const [pendingDelete, setPendingDelete] = useState<MandateRow | null>(null);

  async function doDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteMandate(id);
    qc.invalidateQueries({ queryKey: ['mandates'] });
  }

  // ── group mandates by frequency ──
  const mandates = data ?? [];
  const grouped = FREQUENCIES.map((f) => ({
    frequency: f,
    items: mandates.filter((m) => m.frequency === f),
  })).filter((g) => g.items.length > 0);

  return (
    <Screen>
      {/* ── Add form ── */}
      <Card>
        <H2>Add mandate</H2>
        <View style={{ height: 8 }} />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name (e.g. Netflix)"
          placeholderTextColor={colors.ghost}
          style={inputStyle}
        />
        <View style={{ height: 8 }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="Amount"
            placeholderTextColor={colors.ghost}
            keyboardType="numeric"
            style={[inputStyle, { flex: 1 }]}
          />
          <TextInput
            value={dayOfCycle}
            onChangeText={setDayOfCycle}
            placeholder="Day"
            placeholderTextColor={colors.ghost}
            keyboardType="numeric"
            style={[inputStyle, { width: 64 }]}
          />
        </View>

        <View style={{ height: 8 }} />
        <Muted>Platform</Muted>
        <View style={{ height: 4 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
          <View style={styles.pills}>
            {PLATFORMS.map((p) => (
              <Pressable
                key={p.value}
                onPress={() => setPlatform(p.value as MandateRow['platform'])}
                style={[styles.optionPill, platform === p.value && styles.optionPillSel]}
              >
                <Text style={[styles.optionText, platform === p.value && styles.optionTextSel]}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View style={{ height: 8 }} />
        <Muted>Frequency</Muted>
        <View style={{ height: 4 }} />
        <View style={styles.pills}>
          {FREQUENCIES.map((f) => (
            <Pressable
              key={f}
              onPress={() => setFrequency(f)}
              style={[styles.optionPill, frequency === f && styles.optionPillSel]}
            >
              <Text style={[styles.optionText, frequency === f && styles.optionTextSel]}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ height: 8 }} />
        <Muted>Category</Muted>
        <View style={{ height: 4 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
          <View style={styles.pills}>
            {categories.map((c) => (
              <CategoryPill key={c} name={c} selected={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
        </ScrollView>

        <View style={{ height: 8 }} />
        <TextInput
          value={merchantHint}
          onChangeText={setMerchantHint}
          placeholder="Merchant hint (optional)"
          placeholderTextColor={colors.ghost}
          style={inputStyle}
        />
        <View style={{ height: 8 }} />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional)"
          placeholderTextColor={colors.ghost}
          style={inputStyle}
        />
        <View style={{ height: 10 }} />
        <Button title="Add Mandate" onPress={add} disabled={!name.trim() || !amount.trim() || !category} />
      </Card>

      {/* ── Mandate list ── */}
      <Card>
        <H2>Mandates</H2>
        <View style={{ height: 6 }} />
        {isLoading ? (
          <Loading />
        ) : mandates.length === 0 ? (
          <Muted>No mandates yet. Add one above.</Muted>
        ) : (
          grouped.map((g) => (
            <View key={g.frequency}>
              <Text style={styles.groupLabel}>
                {g.frequency.charAt(0).toUpperCase() + g.frequency.slice(1)}
              </Text>
              {g.items.map((m) => {
                const due = nextDueDate(m.day_of_cycle, m.frequency);
                const isToday = formatDueDate(due) === 'Today';
                return (
                  <View key={m.id} style={styles.row}>
                    <View style={styles.info}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.mandateName} numberOfLines={1}>{m.name}</Text>
                        {!m.active && (
                          <View style={styles.inactiveBadge}>
                            <Text style={styles.inactiveBadgeText}>Inactive</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <Text style={styles.mandateSub}>{platformLabel(m.platform)}</Text>
                        <Text style={styles.mandateSub}>·</Text>
                        <Text style={styles.mandateSub}>{cycleLabel(m.day_of_cycle, m.frequency)}</Text>
                        <Text style={styles.mandateSub}>·</Text>
                        <Text style={styles.mandateSub}>{m.category}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <Text style={styles.mandateAmount}>₹{formatNum(m.amount)}</Text>
                        <View style={[styles.dueBadge, isToday && styles.dueBadgeToday]}>
                          <Text style={[styles.dueBadgeText, isToday && styles.dueBadgeTextToday]}>
                            {formatDueWithDate(due)}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.actions}>
                      <Switch
                        value={!!m.active}
                        onValueChange={() => toggle(m)}
                        trackColor={{ false: colors.surface3, true: colors.accentDim }}
                        thumbColor={m.active ? colors.accent : colors.ghost}
                      />
                      <Pressable
                        onPress={() => setPendingDelete(m)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Delete mandate ${m.name}`}
                        style={({ pressed }) => pressed && { opacity: 0.6 }}
                      >
                        <Text style={styles.deleteText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ))
        )}
      </Card>

      <ConfirmDialog
        visible={!!pendingDelete}
        title="Delete mandate?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" (₹${formatNum(pendingDelete.amount)}, ${pendingDelete.frequency}) will stop being tracked. Past transactions are not affected.`
            : ''
        }
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={doDelete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 4 },
  optionPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline2,
    backgroundColor: colors.surface2,
  },
  optionPillSel: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  optionText: { color: colors.sub, fontSize: 12.5, fontWeight: '600' },
  optionTextSel: { color: colors.bg },
  groupLabel: {
    color: colors.ghost,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  info: { flex: 1 },
  mandateName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  mandateSub: { color: colors.ghost, fontSize: 11.5 },
  mandateAmount: { color: colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dueBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colors.surface3,
  },
  dueBadgeToday: { backgroundColor: colors.accentDim },
  dueBadgeText: { color: colors.sub, fontSize: 10.5, fontWeight: '600' },
  dueBadgeTextToday: { color: colors.accent },
  inactiveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.surface3,
  },
  inactiveBadgeText: { color: colors.ghost, fontSize: 9.5, fontWeight: '600', textTransform: 'uppercase' },
  actions: { alignItems: 'center', gap: 8, marginLeft: 8 },
  deleteText: { color: colors.neg, fontSize: 11, fontWeight: '600' },
});
