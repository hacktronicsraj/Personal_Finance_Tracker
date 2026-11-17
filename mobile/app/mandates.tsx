import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  createMandate,
  deleteMandate,
  fetchMandates,
  fetchRecurringSuggestions,
  MandateRow,
  patchMandate,
  RecurringSuggestion,
} from '../src/api/client';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { WhenField } from '../src/components/WhenPicker';
import { formatNum } from '../src/config';
import { useCategories } from '../src/hooks';
import { cycleLabel, emiProgress, formatDueDate, formatDueWithDate, nextDueDate, platformLabel, PLATFORMS } from '../src/mandates';
import { Button, Card, CategoryPill, colors, H2, inputStyle, Loading, Muted, Screen } from '../src/ui';

const FREQUENCIES = ['monthly', 'weekly', 'quarterly', 'yearly'] as const;

export default function MandatesScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['mandates'], queryFn: fetchMandates });
  const suggestionsQ = useQuery<RecurringSuggestion[]>({
    queryKey: ['mandate-suggestions'],
    queryFn: fetchRecurringSuggestions,
    staleTime: 10 * 60 * 1000,
  });
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Track a detected charge as a mandate, pre-filled from what was observed.
  async function acceptSuggestion(sg: RecurringSuggestion) {
    await createMandate({
      name: sg.merchant,
      platform: 'bank_autopay',
      amount: sg.amount,
      day_of_cycle: sg.dayOfCycle,
      frequency: sg.frequency,
      category: sg.category,
      merchant_hint: sg.merchant,
    } as any);
    qc.invalidateQueries({ queryKey: ['mandates'] });
    qc.invalidateQueries({ queryKey: ['mandate-suggestions'] });
  }
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
  // EMI mode
  const [isEmi, setIsEmi] = useState(false);
  const [emiTotal, setEmiTotal] = useState('');
  const [emiStart, setEmiStart] = useState<Date | null>(null);

  const emiValid = !isEmi || (Number(emiTotal) >= 1 && !!emiStart);
  const canAdd = !!name.trim() && !!amount.trim() && !!category && emiValid;

  async function add() {
    if (!canAdd) return;
    // For an EMI the cycle anchor is derived from the first-installment date —
    // weekday (0–6) for a weekly EMI, day-of-month otherwise, matching how
    // nextDueDate/cycleLabel interpret day_of_cycle per frequency.
    const day = isEmi && emiStart
      ? (frequency === 'weekly' ? emiStart.getDay() : emiStart.getDate())
      : parseInt(dayOfCycle, 10) || 1;
    await createMandate({
      name: name.trim(),
      amount: parseFloat(amount),
      day_of_cycle: day,
      platform,
      frequency,
      category,
      merchant_hint: merchantHint.trim() || null,
      notes: notes.trim() || null,
      emi_total: isEmi ? Math.max(1, parseInt(emiTotal, 10) || 1) : null,
      emi_start: isEmi && emiStart ? emiStart.toISOString() : null,
    });
    setName('');
    setAmount('');
    setDayOfCycle('1');
    setMerchantHint('');
    setNotes('');
    setCategory(null);
    setIsEmi(false);
    setEmiTotal('');
    setEmiStart(null);
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

  const suggestions = (suggestionsQ.data ?? []).filter((s) => !dismissed.includes(s.pattern));

  return (
    <Screen>
      {/* ── Detected recurring charges not yet tracked ── */}
      {suggestions.length > 0 && (
        <Card>
          <H2>Looks recurring</H2>
          <Muted style={{ marginTop: 4 }}>
            Charges that repeat on a cycle but aren't tracked yet.
          </Muted>
          {suggestions.map((sg) => (
            <View key={sg.pattern} style={styles.sgRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sgName} numberOfLines={1}>{sg.merchant}</Text>
                <Text style={styles.sgSub}>
                  ₹{formatNum(sg.amount)} · {sg.frequency === 'weekly' ? 'weekly' : `monthly on the ${sg.dayOfCycle}`}
                  {' · '}seen {sg.occurrences}×
                </Text>
              </View>
              <Pressable
                onPress={() => acceptSuggestion(sg)}
                accessibilityRole="button"
                accessibilityLabel={`Track ${sg.merchant}`}
                style={({ pressed }) => [styles.sgTrack, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.sgTrackText}>Track</Text>
              </Pressable>
              <Pressable
                onPress={() => setDismissed((d) => [...d, sg.pattern])}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss ${sg.merchant}`}
                style={({ pressed }) => [styles.sgSkip, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.sgSkipText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      {/* ── Add form ── */}
      <Card>
        <H2>Add mandate / EMI</H2>
        <View style={{ height: 8 }} />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name (e.g. Netflix, Car loan)"
          placeholderTextColor={colors.ghost}
          style={inputStyle}
        />
        <View style={{ height: 8 }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder={isEmi ? 'Amount / month' : 'Amount'}
            placeholderTextColor={colors.ghost}
            keyboardType="numeric"
            style={[inputStyle, { flex: 1 }]}
          />
          {!isEmi && (
            <TextInput
              value={dayOfCycle}
              onChangeText={setDayOfCycle}
              placeholder="Day"
              placeholderTextColor={colors.ghost}
              keyboardType="numeric"
              style={[inputStyle, { width: 64 }]}
            />
          )}
        </View>

        {/* EMI toggle */}
        <View style={styles.emiToggle}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.emiTitle}>EMI / loan</Text>
            <Muted style={{ marginTop: 1 }}>Track installments and progress toward payoff.</Muted>
          </View>
          <Switch
            value={isEmi}
            onValueChange={(v) => { setIsEmi(v); if (v && !emiStart) setEmiStart(new Date()); }}
            accessibilityLabel="EMI or loan"
            trackColor={{ false: colors.surface3, true: colors.accentDim }}
            thumbColor={isEmi ? colors.accent : colors.ghost}
          />
        </View>
        {isEmi && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                value={emiTotal}
                onChangeText={(t) => setEmiTotal(t.replace(/\D/g, '').slice(0, 3))}
                placeholder="Total installments (e.g. 12)"
                placeholderTextColor={colors.ghost}
                keyboardType="number-pad"
                style={[inputStyle, { flex: 1 }]}
              />
            </View>
            <Text style={styles.emiFieldLabel}>First installment</Text>
            <WhenField value={emiStart} onChange={setEmiStart} />
          </View>
        )}

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
        <Button title={isEmi ? 'Add EMI' : 'Add mandate'} onPress={add} disabled={!canAdd} />
      </Card>

      {/* ── Mandate / EMI list ── */}
      <Card>
        <H2>Mandates &amp; EMIs</H2>
        <View style={{ height: 6 }} />
        {isLoading ? (
          <Loading />
        ) : mandates.length === 0 ? (
          <Muted>No mandates or EMIs yet. Add one above.</Muted>
        ) : (
          grouped.map((g) => (
            <View key={g.frequency}>
              <Text style={styles.groupLabel}>
                {g.frequency.charAt(0).toUpperCase() + g.frequency.slice(1)}
              </Text>
              {g.items.map((m) => {
                const emi = emiProgress(m);
                const due = nextDueDate(m.day_of_cycle, m.frequency);
                const isToday = formatDueDate(due) === 'Today';
                const dimmed = emi?.done || !m.active;
                return (
                  <View key={m.id} style={styles.row}>
                    <View style={[styles.info, dimmed && { opacity: 0.55 }]}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.mandateName} numberOfLines={1}>{m.name}</Text>
                        {emi && (
                          <View style={styles.emiBadge}>
                            <Text style={styles.emiBadgeText}>EMI</Text>
                          </View>
                        )}
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
                        {emi?.done ? (
                          <View style={[styles.dueBadge, styles.doneBadge]}>
                            <Text style={[styles.dueBadgeText, styles.doneBadgeText]}>Completed</Text>
                          </View>
                        ) : (
                          <View style={[styles.dueBadge, isToday && styles.dueBadgeToday]}>
                            <Text style={[styles.dueBadgeText, isToday && styles.dueBadgeTextToday]}>
                              {formatDueWithDate(due)}
                            </Text>
                          </View>
                        )}
                      </View>
                      {emi && (
                        <View style={{ marginTop: 6 }}>
                          <View style={styles.emiRow}>
                            <Text style={styles.emiProgressText}>EMI {emi.paid}/{emi.total}</Text>
                            <Text style={styles.emiRemainingText}>
                              {emi.done ? 'Paid off' : `${emi.remaining} left · ₹${formatNum(emi.remaining * m.amount)}`}
                            </Text>
                          </View>
                          <View style={styles.emiBar}>
                            <View style={[styles.emiFill, { width: `${Math.round((emi.paid / emi.total) * 100)}%` }]} />
                          </View>
                        </View>
                      )}
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
                        accessibilityLabel={`Delete ${m.name}`}
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
        title={emiProgress(pendingDelete ?? ({} as MandateRow)) ? 'Delete EMI?' : 'Delete mandate?'}
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
  sgRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  sgName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sgSub: { color: colors.sub, fontSize: 12, marginTop: 2 },
  sgTrack: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accentLine,
  },
  sgTrackText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  sgSkip: { paddingHorizontal: 8, paddingVertical: 6 },
  sgSkipText: { color: colors.ghost, fontSize: 14 },
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
  emiToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  emiTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  emiFieldLabel: { color: colors.ghost, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
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
  doneBadge: { backgroundColor: colors.accentDim },
  doneBadgeText: { color: colors.accent },
  emiBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.accentDim,
  },
  emiBadgeText: { color: colors.accent, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  emiRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  emiProgressText: { color: colors.sub, fontSize: 11, fontWeight: '700' },
  emiRemainingText: { color: colors.ghost, fontSize: 11 },
  emiBar: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden' },
  emiFill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
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
