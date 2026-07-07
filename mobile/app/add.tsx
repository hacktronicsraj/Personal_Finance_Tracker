import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { CATEGORIES } from '../src/config';
import { removeReview } from '../src/db/database';
import { screenshotToPayment, textToPayment } from '../src/capture';
import { parseTransaction } from '../src/parse/parser';
import type { ParsedTxn } from '../src/parse/types';
import { saveConfirmed } from '../src/sms/ingest';
import { Button, Card, CategoryPill, colors, H2, inputStyle, Muted, Screen } from '../src/ui';

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Confirm-and-save screen. Reached from: the share sheet (GPay screenshot →
 * vision extract, or PhonePe/Paytm text → parse), the "Add manually" button, and
 * the review queue. Always saves a SPEND (debit) with the user-chosen category.
 */
export default function AddScreen() {
  const params = useLocalSearchParams();
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
        // Google Pay share → read the screenshot with the backend vision model.
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
        // Review queue: a bank SMS we couldn't parse — try both parsers as a hint.
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
    });
    if (reviewId) await removeReview(reviewId).catch(() => {});
    qc.invalidateQueries();
    if (transaction || queued) {
      router.back();
    } else {
      setStatus('Could not save — try again.');
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Card>
        <H2>Add a spend</H2>
        <Muted style={{ marginTop: 4 }}>
          {source === 'shared'
            ? 'Shared from a payment app.'
            : reviewId
              ? 'Complete this transaction we couldn’t auto-read.'
              : 'Log a payment manually.'}
        </Muted>

        {extracting ? (
          <View style={styles.extract}>
            <ActivityIndicator color={colors.accent} />
            <Muted style={{ marginTop: 8 }}>Reading the screenshot…</Muted>
          </View>
        ) : (
          <>
            <View style={{ height: 14 }} />
            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.ghost}
              style={[inputStyle, styles.amount]}
            />
            <View style={{ height: 12 }} />
            <Text style={styles.label}>Paid to</Text>
            <TextInput
              value={merchant}
              onChangeText={setMerchant}
              placeholder="Merchant / payee"
              placeholderTextColor={colors.ghost}
              autoCapitalize="words"
              style={inputStyle}
            />
          </>
        )}
      </Card>

      {!extracting && (
        <Card>
          <Text style={styles.label}>Category {category ? '' : '(optional — auto if skipped)'}</Text>
          <View style={styles.pills}>
            {CATEGORIES.filter((c) => c !== 'Income').map((c) => (
              <CategoryPill key={c} name={c} selected={category === c} onPress={() => setCategory(c)} />
            ))}
          </View>
        </Card>
      )}

      {!!rawText && !extracting && (
        <Card>
          <Text style={styles.label}>Original message</Text>
          <Muted style={{ marginTop: 6 }}>{rawText}</Muted>
        </Card>
      )}

      {!!status && <Muted style={{ paddingHorizontal: 4 }}>{status}</Muted>}

      {!extracting && (
        <Button title={saving ? 'Saving…' : 'Save spend'} onPress={save} disabled={!canSave} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  extract: { paddingVertical: 28, alignItems: 'center' },
  label: { color: colors.sub, fontSize: 12.5, fontWeight: '700', marginBottom: 6 },
  amount: { fontSize: 22, fontWeight: '800' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
});
