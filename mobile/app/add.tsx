import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { uploadAttachment } from '../src/api/client';
import { pickDocument, pickImageFromCamera, pickImageFromLibrary, type PickedFile } from '../src/attachments';
import { removeReview } from '../src/db/database';
import { screenshotToPayment, textToPayment } from '../src/capture';
import { CameraIcon, CloseIcon, FileIcon, GalleryIcon } from '../src/components/icons';
import { TagEditor } from '../src/components/TagEditor';
import { useAllTags, useCategories } from '../src/hooks';
import { parseTransaction } from '../src/parse/parser';
import type { ParsedTxn } from '../src/parse/types';
import { saveConfirmed } from '../src/sms/ingest';
import { Button, CategoryPill, colors, inputStyle, Muted, Screen } from '../src/ui';

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Confirm-and-save sheet. Reached from: the share sheet (GPay screenshot → vision
 * extract, or PhonePe/Paytm text → parse), the Home "+" (manual), and the review
 * queue. Always saves a SPEND (debit) with the user-chosen category.
 */
export default function AddScreen() {
  const params = useLocalSearchParams();
  const categories = useCategories();
  const tagSuggestions = useAllTags();
  const source = one(params.source) ?? 'manual';
  const reviewId = one(params.reviewId);
  const sharedText = one(params.text);
  const imageUri = one(params.imageUri);
  const rawText = one(params.rawText) ?? sharedText ?? '';

  const qc = useQueryClient();
  const [extracting, setExtracting] = useState(!!imageUri);
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [staged, setStaged] = useState<PickedFile[]>([]);
  const [occurredAt, setOccurredAt] = useState<string | undefined>();
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const prefill = (p: ParsedTxn | null) => {
    if (!p) return;
    if (p.amount) setAmount(String(p.amount));
    if (p.merchant) setMerchant(p.merchant);
    if (p.occurredAt) setOccurredAt(p.occurredAt);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (imageUri) {
        try {
          const p = await screenshotToPayment(imageUri);
          if (!alive) return;
          if (p) prefill(p);
          else setStatus("Couldn't read the screenshot — enter the amount below.");
        } catch {
          if (alive) setStatus("Couldn't read the screenshot — enter the amount below.");
        } finally {
          if (alive) setExtracting(false);
        }
      } else if (sharedText) {
        prefill(textToPayment(sharedText));
      } else if (rawText) {
        prefill(parseTransaction(rawText) ?? textToPayment(rawText));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amountNum = useMemo(() => Number(amount.replace(/[^\d.]/g, '')), [amount]);
  const canSave = Number.isFinite(amountNum) && amountNum > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    const parsed: ParsedTxn = {
      amount: amountNum,
      direction: 'debit',
      currency: 'INR',
      merchant: merchant.trim() || undefined,
      occurredAt,
    };
    const { transaction, queued } = await saveConfirmed(parsed, {
      source,
      rawText,
      category: category ?? undefined,
      note: note.trim() || undefined,
      tags: tags.length ? tags : undefined,
    });
    // Attachments need the saved txn id + connectivity; upload after a real save.
    if (transaction && staged.length) {
      for (const f of staged) {
        try {
          await uploadAttachment(transaction.id, f.base64, f.mime);
        } catch {
          /* per-file failure — leave the rest */
        }
      }
    } else if (queued && staged.length) {
      Alert.alert('Saved offline', 'Receipts couldn’t upload offline — add them from the transaction once you’re back online.');
    }
    if (reviewId) await removeReview(reviewId).catch(() => {});
    qc.invalidateQueries();
    if (transaction || queued) {
      router.back();
    } else {
      setStatus('Could not save — try again.');
      setSaving(false);
    }
  }

  async function stage(pick: () => Promise<PickedFile | null>) {
    try {
      const f = await pick();
      if (f?.base64) setStaged((prev) => [...prev, f]);
    } catch {
      Alert.alert('Could not attach', 'Try again.');
    }
  }

  const title = source === 'shared' ? 'Confirm shared spend' : reviewId ? 'Complete this spend' : 'Add a spend';

  return (
    <Screen>
      <View style={styles.grabber} />
      <Text style={styles.sheetTitle}>{title}</Text>

      {extracting ? (
        <View style={styles.extract}>
          <ActivityIndicator color={colors.accent} />
          <Muted style={{ marginTop: 10 }}>Reading the screenshot…</Muted>
        </View>
      ) : (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.ghost}
              style={[inputStyle, styles.amount]}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Paid to</Text>
            <TextInput
              value={merchant}
              onChangeText={setMerchant}
              placeholder="Merchant / payee"
              placeholderTextColor={colors.ghost}
              autoCapitalize="words"
              style={inputStyle}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Category <Text style={styles.hint}>{category ? '' : '· auto if skipped'}</Text>
            </Text>
            <View style={styles.pills}>
              {categories.filter((c) => c !== 'Income').map((c) => (
                <CategoryPill key={c} name={c} selected={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Tags <Text style={styles.hint}>· optional</Text>
            </Text>
            <TagEditor value={tags} onChange={setTags} suggestions={tagSuggestions} placeholder="e.g. trip, work, reimburse…" />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Receipts <Text style={styles.hint}>· optional</Text>
            </Text>
            {staged.length > 0 && (
              <View style={styles.stageRow}>
                {staged.map((f, i) => (
                  <View key={i} style={styles.stageThumb}>
                    {f.mime.startsWith('image/') ? (
                      <Image source={{ uri: `data:${f.mime};base64,${f.base64}` }} style={styles.stageImg} />
                    ) : (
                      <Text style={styles.stageExt}>{f.mime.includes('pdf') ? 'PDF' : 'FILE'}</Text>
                    )}
                    <Pressable
                      onPress={() => setStaged((p) => p.filter((_, j) => j !== i))}
                      style={({ pressed }) => [styles.stageX, pressed && { opacity: 0.6 }]}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel="Remove receipt"
                    >
                      <CloseIcon size={10} color={colors.text} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.stageBtns}>
              <StageBtn label="Camera" icon={<CameraIcon size={15} />} onPress={() => stage(pickImageFromCamera)} />
              <StageBtn label="Gallery" icon={<GalleryIcon size={15} />} onPress={() => stage(pickImageFromLibrary)} />
              <StageBtn label="File" icon={<FileIcon size={15} />} onPress={() => stage(pickDocument)} />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>
              Notes <Text style={styles.hint}>· optional</Text>
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder='e.g. "dinner with Priya", "office cab"'
              placeholderTextColor={colors.ghost}
              multiline
              style={[inputStyle, styles.area]}
            />
          </View>

          {!!rawText && (
            <View style={styles.field}>
              <Text style={styles.label}>Original message</Text>
              <Muted style={{ marginTop: 2 }}>{rawText}</Muted>
            </View>
          )}

          <Text style={styles.teach}>
            Your category choice trains the classifier —{'\n'}the next similar payment gets guessed right.
          </Text>
          {!!status && <Muted style={{ textAlign: 'center', marginBottom: 8 }}>{status}</Muted>}
          <Button title={saving ? 'Saving…' : 'Save spend'} onPress={save} disabled={!canSave} />
        </>
      )}
    </Screen>
  );
}

function StageBtn({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Add receipt from ${label}`}
      style={({ pressed }) => [styles.stageBtn, pressed && { opacity: 0.6 }]}
    >
      {icon}
      <Text style={styles.stageBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#23242E', alignSelf: 'center', marginTop: 2 },
  sheetTitle: { color: colors.sub, fontSize: 13, textAlign: 'center', marginTop: 10, fontWeight: '600' },
  extract: { paddingVertical: 40, alignItems: 'center' },
  field: { marginTop: 16 },
  label: {
    color: colors.ghost,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  hint: { color: colors.ghost, fontWeight: '400', letterSpacing: 0, textTransform: 'none', fontSize: 11 },
  amount: { fontSize: 22, fontWeight: '800' },
  area: { minHeight: 72, textAlignVertical: 'top', lineHeight: 20 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  teach: { color: colors.ghost, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: 22, marginBottom: 12 },
  stageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  stageThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stageImg: { width: '100%', height: '100%' },
  stageExt: { color: colors.sub, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  stageX: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.hairline2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageBtns: { flexDirection: 'row', gap: 8 },
  stageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline2,
    backgroundColor: colors.surface2,
  },
  stageBtnText: { color: colors.sub, fontSize: 12.5, fontWeight: '600' },
});
