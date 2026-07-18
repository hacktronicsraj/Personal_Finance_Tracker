import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteTransaction, parseTags, patchTransaction } from '../../src/api/client';
import { categoryColor, formatINR } from '../../src/config';
import { deleteTxn, upsertTxn } from '../../src/db/database';
import { useAllTags, useCategories, useTransaction } from '../../src/hooks';
import { TagEditor } from '../../src/components/TagEditor';
import { AttachmentsSection } from '../../src/components/AttachmentsSection';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';
import { PencilIcon } from '../../src/components/icons';
import { Button, Card, CategoryPill, Chip, colors, Kicker, Loading, Money, Muted, Screen } from '../../src/ui';

/** Order-insensitive tag equality for dirty-checking. */
function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = [...b].sort();
  return [...a].sort().every((t, i) => t === sb[i]);
}

type Field = 'amount' | 'merchant' | 'category' | null;

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: txn, isLoading } = useTransaction(id);
  const categories = useCategories();
  const tagSuggestions = useAllTags();
  const qc = useQueryClient();

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [editing, setEditing] = useState<Field>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (txn && !loaded) {
      setAmount(String(txn.amount));
      setMerchant(txn.merchant ?? '');
      setCategory(txn.category);
      setNote(txn.user_note ?? '');
      setTags(parseTags(txn.tags));
      setLoaded(true);
    }
  }, [txn, loaded]);

  const amountNum = useMemo(() => Number(amount.replace(/[^\d.]/g, '')), [amount]);
  const dirty =
    !!txn &&
    (amountNum !== txn.amount ||
      merchant.trim() !== (txn.merchant ?? '') ||
      category !== txn.category ||
      note.trim() !== (txn.user_note ?? '') ||
      !sameTags(tags, parseTags(txn.tags)));

  async function save() {
    if (!txn || !dirty || saving) return;
    setSaving(true);
    const fields: { amount?: number; merchant?: string; category?: string; note?: string; tags?: string[] } = {};
    if (Number.isFinite(amountNum) && amountNum > 0 && amountNum !== txn.amount) fields.amount = amountNum;
    if (merchant.trim() !== (txn.merchant ?? '')) fields.merchant = merchant.trim();
    if (category !== txn.category) fields.category = category;
    if (note.trim() !== (txn.user_note ?? '')) fields.note = note.trim();
    if (!sameTags(tags, parseTags(txn.tags))) fields.tags = tags;
    try {
      const updated = await patchTransaction(txn.id, fields);
      await upsertTxn(updated);
      qc.invalidateQueries();
      router.back();
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!txn) return;
    setConfirmDelete(false);
    try {
      await deleteTransaction(txn.id);
      await deleteTxn(txn.id);
      qc.invalidateQueries();
      router.back();
    } catch {
      Alert.alert('Could not delete', 'Check your connection and try again.');
    }
  }

  if (isLoading || !loaded) return <Screen><Loading /></Screen>;
  if (!txn) return <Screen><Muted>Transaction not found.</Muted></Screen>;

  const where = [merchant.trim() || 'Unknown', [txn.bank, txn.account_tail ? `··${txn.account_tail}` : null].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ');
  const dateStr = txn.occurred_at
    ? new Date(txn.occurred_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <Screen>
      {/* Header */}
      <View style={{ paddingHorizontal: 2, paddingTop: 2 }}>
        <Kicker>{txn.direction === 'debit' ? 'Paid' : 'Received'} · {category}</Kicker>
        <View style={{ marginTop: 6 }}>
          <Money value={Number.isFinite(amountNum) ? amountNum : txn.amount} size={34} />
        </View>
        <Text style={styles.sub}>{where}</Text>
        <View style={{ marginTop: 8, flexDirection: 'row' }}>
          {txn.corrected ? (
            <Chip label="✓ confirmed by you" bg="rgba(58,220,151,0.12)" color={colors.pos} />
          ) : (
            <Chip label={`LLM guess · ${Math.round(txn.confidence * 100)}%`} bg="rgba(148,163,184,0.12)" color="#AAB1C2" />
          )}
        </View>
      </View>

      {/* Editable fields — tap the pencil to edit inline */}
      <Card style={{ paddingVertical: 4 }}>
        <EditRow
          label="Amount"
          editing={editing === 'amount'}
          onEdit={() => setEditing(editing === 'amount' ? null : 'amount')}
          display={`₹${amount}`}
        >
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            autoFocus
            onBlur={() => setEditing(null)}
            style={styles.inlineInput}
            placeholderTextColor={colors.ghost}
          />
        </EditRow>

        <EditRow
          label="Merchant"
          editing={editing === 'merchant'}
          onEdit={() => setEditing(editing === 'merchant' ? null : 'merchant')}
          display={merchant || '—'}
        >
          <TextInput
            value={merchant}
            onChangeText={setMerchant}
            autoFocus
            autoCapitalize="words"
            onBlur={() => setEditing(null)}
            style={styles.inlineInput}
            placeholder="Merchant / payee"
            placeholderTextColor={colors.ghost}
          />
        </EditRow>

        <Pressable
          onPress={() => setEditing(editing === 'category' ? null : 'category')}
          accessibilityRole="button"
          accessibilityLabel={`Category: ${category}. Tap to change`}
          style={({ pressed }) => [styles.row, styles.rowBorder, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.rowLabel}>Category</Text>
          <View style={styles.rowRight}>
            <View style={[styles.dot, { backgroundColor: categoryColor(category) }]} />
            <Text style={styles.rowValue}>{category}</Text>
            <PencilIcon />
          </View>
        </Pressable>
        {editing === 'category' && (
          <View style={styles.pills}>
            {categories.map((c) => (
              <CategoryPill key={c} name={c} selected={category === c} onPress={() => { setCategory(c); setEditing(null); }} />
            ))}
          </View>
        )}

        <View style={[styles.row, styles.rowBorder]}>
          <Text style={styles.rowLabel}>Date</Text>
          <Text style={[styles.rowValue, styles.rowMuted]}>{dateStr}</Text>
        </View>
        {!!txn.ref_no && (
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>Reference</Text>
            <Text style={[styles.rowValue, styles.rowMuted]} numberOfLines={1}>{txn.ref_no}</Text>
          </View>
        )}
        {txn.balance != null && (
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>Balance after</Text>
            <Text style={[styles.rowValue, styles.rowMuted]}>{formatINR(txn.balance)}</Text>
          </View>
        )}
      </Card>

      {/* Tags */}
      <Card>
        <Text style={styles.cardLabel}>Tags <Text style={{ color: colors.ghost, fontWeight: '400' }}>(optional)</Text></Text>
        <TagEditor value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="e.g. trip, work, reimburse…" />
      </Card>

      {/* Attachments (receipts) */}
      <Card>
        <Text style={styles.cardLabel}>Attachments <Text style={{ color: colors.ghost, fontWeight: '400' }}>(receipts)</Text></Text>
        <AttachmentsSection txnId={txn.id} />
      </Card>

      {/* Notes */}
      <Card>
        <Text style={styles.cardLabel}>Notes <Text style={{ color: colors.ghost, fontWeight: '400' }}>(optional)</Text></Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Add context you'll want later…"
          placeholderTextColor={colors.ghost}
          multiline
          style={styles.notesBox}
        />
      </Card>

      {!!txn.raw_text && (
        <Card>
          <Kicker>Original message</Kicker>
          <Text style={styles.raw}>{txn.raw_text}</Text>
        </Card>
      )}

      <View style={styles.savebar}>
        <Button title="Delete" variant="ghost" onPress={() => setConfirmDelete(true)} />
        <View style={{ flex: 1 }}>
          <Button title={saving ? 'Saving…' : dirty ? 'Save changes' : 'No changes'} onPress={save} disabled={!dirty || saving} />
        </View>
      </View>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete transaction?"
        message={`This removes ${merchant.trim() || 'this transaction'} (₹${amount}) from your spending and cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
    </Screen>
  );
}

function EditRow({
  label,
  display,
  editing,
  onEdit,
  children,
}: {
  label: string;
  display: string;
  editing: boolean;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.row, styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      {editing ? (
        <View style={{ flex: 1 }}>{children}</View>
      ) : (
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${display}. Tap to edit`}
          style={({ pressed }) => [styles.rowRight, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.rowValue} numberOfLines={1}>{display}</Text>
          <PencilIcon />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { color: colors.sub, fontSize: 14, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 13, paddingHorizontal: 2 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowLabel: { color: colors.sub, fontSize: 13, flexShrink: 0 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1, justifyContent: 'flex-end' },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },
  rowMuted: { color: colors.ghost, fontWeight: '500' },
  dot: { width: 9, height: 9, borderRadius: 3 },
  inlineInput: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 10, paddingHorizontal: 2 },
  cardLabel: { color: colors.sub, fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  notesBox: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 13,
    padding: 13,
    color: colors.text,
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  raw: { color: colors.sub, fontSize: 12.5, lineHeight: 19, marginTop: 8 },
  savebar: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
});
