import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  applyStatement,
  fetchStatement,
  type StatementDecision,
  type StatementDetail,
  type StatementItem,
} from '../../src/api/client';
import { AppHeader } from '../../src/components/AppHeader';
import { formatINR } from '../../src/config';
import { Button, Card, colors, Loading, Muted, Screen } from '../../src/ui';

type Choice = 'approve' | 'deny';

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

export default function StatementReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const [detail, setDetail] = useState<StatementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchStatement(String(id))
      .then((d) => {
        setDetail(d);
        // Seed each pending item with its suggested decision.
        const seed: Record<string, Choice> = {};
        for (const it of d.items) {
          if (it.kind !== 'match' && !it.decision) seed[it.id] = it.suggested === 'deny' ? 'deny' : 'approve';
        }
        setChoices(seed);
      })
      .catch(() => setError('Could not load this statement.'))
      .finally(() => setLoading(false));
  }, [id]);

  const grouped = useMemo(() => {
    const items = detail?.items ?? [];
    return {
      adds: items.filter((i) => i.kind === 'add'),
      removes: items.filter((i) => i.kind === 'remove'),
      matches: items.filter((i) => i.kind === 'match'),
    };
  }, [detail]);

  const applied = detail?.statement.status === 'applied';

  async function apply() {
    if (!detail) return;
    setApplying(true);
    setError('');
    const decisions: Record<string, StatementDecision> = {};
    for (const it of detail.items) {
      if (it.kind === 'match') continue;
      decisions[it.id] = choices[it.id] ?? 'deny';
    }
    try {
      const res = await applyStatement(detail.statement.id, decisions);
      setDetail(res);
      qc.invalidateQueries();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setApplying(false);
    }
  }

  if (loading) return <Screen><Loading /></Screen>;
  if (!detail) return <Screen><Muted>{error || 'Not found.'}</Muted></Screen>;

  const s = detail.statement;
  const pendingCount = grouped.adds.length + grouped.removes.length;
  const approving = Object.values(choices).filter((c) => c === 'approve').length;

  return (
    <Screen>
      <AppHeader title="Reconcile" meta={s.parser === 'llm' ? 'ai-read' : 'parsed'} />
      <Card>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>
          {s.bank ?? 'Statement'} {s.account_tail ? `····${s.account_tail}` : ''}
        </Text>
        <Muted style={{ marginTop: 4 }}>
          {fmtDate(s.period_start)} – {fmtDate(s.period_end)} · {s.debit_count} debits
          {s.credit_count > 0 ? ` · ${s.credit_count} credit${s.credit_count === 1 ? '' : 's'} ignored` : ''}
        </Muted>
        <Muted style={{ marginTop: 2 }}>
          {grouped.matches.length} already match · balances reconciled {s.balance_ok}/{s.balance_checked}
        </Muted>
      </Card>

      {applied && (
        <View style={[styles.doneBanner]}>
          <Text style={{ color: colors.accent, fontWeight: '700' }}>
            Applied — added {s.added}, removed {s.removed}.
          </Text>
        </View>
      )}

      {grouped.adds.length > 0 && (
        <>
          <Text style={styles.section}>Missing from your app ({grouped.adds.length})</Text>
          <Muted style={styles.hint}>On the statement but never captured. Approve to add them.</Muted>
          {grouped.adds.map((it) => (
            <ItemRow key={it.id} item={it} choice={choices[it.id]} applied={applied}
              onChoose={(c) => setChoices((m) => ({ ...m, [it.id]: c }))} approveLabel="Add" />
          ))}
        </>
      )}

      {grouped.removes.length > 0 && (
        <>
          <Text style={styles.section}>In your app, not on the statement ({grouped.removes.length})</Text>
          <Muted style={styles.hint}>The bank has no record of these in this period. Approve to remove them.</Muted>
          {grouped.removes.map((it) => (
            <ItemRow key={it.id} item={it} choice={choices[it.id]} applied={applied}
              onChoose={(c) => setChoices((m) => ({ ...m, [it.id]: c }))} approveLabel="Remove" destructive />
          ))}
        </>
      )}

      {pendingCount === 0 && !applied && (
        <Card><Muted>Everything on this statement already matches your ledger. Nothing to do 🎉</Muted></Card>
      )}

      {!!error && <Muted style={{ color: colors.neg }}>{error}</Muted>}

      {!applied && pendingCount > 0 && (
        <View style={{ marginTop: 8, marginBottom: 24 }}>
          <Button
            title={applying ? 'Applying…' : `Apply ${approving} change${approving === 1 ? '' : 's'}`}
            onPress={apply}
            disabled={applying}
          />
          <View style={{ height: 8 }} />
          <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>
      )}
      {applied && (
        <View style={{ marginTop: 8, marginBottom: 24 }}>
          <Button title="Done" onPress={() => router.back()} />
        </View>
      )}
    </Screen>
  );
}

function ItemRow({
  item, choice, onChoose, applied, approveLabel, destructive,
}: {
  item: StatementItem;
  choice?: Choice;
  onChoose: (c: Choice) => void;
  applied: boolean;
  approveLabel: string;
  destructive?: boolean;
}) {
  const decided = applied ? item.decision : null;
  return (
    <Card style={{ paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
            {item.merchant || item.description || 'Transaction'}
          </Text>
          <Muted style={{ marginTop: 2 }}>
            {fmtDate(item.date)} · {formatINR(item.amount)}{item.category ? ` · ${item.category}` : ''}
          </Muted>
          {!!item.note && <Muted style={{ marginTop: 2, fontSize: 11.5, color: colors.amber }}>{item.note}</Muted>}
        </View>
        {applied ? (
          <Text style={{ color: decided === 'approved' ? colors.accent : colors.ghost, fontWeight: '700', fontSize: 12 }}>
            {decided === 'approved' ? approveLabel + 'ed' : 'kept'}
          </Text>
        ) : (
          <View style={styles.toggle}>
            <Pressable
              onPress={() => onChoose('approve')}
              hitSlop={8}
              android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: false }}
              style={({ pressed }) => [
                styles.tBtn,
                choice === 'approve' && (destructive ? styles.tDanger : styles.tOn),
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: choice === 'approve' }}
              accessibilityLabel={approveLabel}
            >
              <Text style={[styles.tText, choice === 'approve' && styles.tTextOn]}>{approveLabel}</Text>
            </Pressable>
            <Pressable
              onPress={() => onChoose('deny')}
              hitSlop={8}
              android_ripple={{ color: 'rgba(255,255,255,0.12)', borderless: false }}
              style={({ pressed }) => [
                styles.tBtn,
                choice === 'deny' && styles.tOn,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: choice === 'deny' }}
              accessibilityLabel="Keep / skip"
            >
              <Text style={[styles.tText, choice === 'deny' && styles.tTextOn]}>Keep</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.text, fontWeight: '700', fontSize: 14, marginTop: 12, paddingHorizontal: 2 },
  hint: { paddingHorizontal: 2, marginTop: -2 },
  doneBanner: { backgroundColor: colors.accentDim, borderRadius: 12, padding: 12 },
  toggle: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: 10, padding: 2, gap: 2, overflow: 'hidden' },
  tBtn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, overflow: 'hidden', minWidth: 56, alignItems: 'center' },
  tOn: { backgroundColor: colors.text },
  tDanger: { backgroundColor: colors.neg },
  tText: { color: colors.sub, fontWeight: '700', fontSize: 12.5 },
  tTextOn: { color: colors.bg },
});
