import { classify, TxnRow, syncSince } from '../api/client';
import {
  addReview,
  getCursor,
  queueOutbox,
  readOutbox,
  removeOutbox,
  setCursor,
  upsertTxn,
} from '../db/database';
import { presentClassifyNotification } from '../notify/notifications';
import { dedupeKey, isFinancialSms, parseTransaction } from '../parse/parser';
import type { ParsedTxn } from '../parse/types';
import { getSettings } from '../settings';
import { refreshWidget } from '../widget';

/** Submit a parsed transaction to the backend; cache it; optionally notify. */
async function submit(
  parsed: ParsedTxn,
  opts: { source: string; rawText: string; category?: string; note?: string; tags?: string[]; notify: boolean },
): Promise<{ transaction: TxnRow | null; queued: boolean }> {
  const { deviceId } = await getSettings();
  // SMS events are re-delivered (re-scan, receiver double-fire), so they need a
  // STABLE key. Manual/shared saves are single-shot — without refNo/occurredAt the
  // key has no entropy, so any later save of the same amount would collide with an
  // old row forever and be silently swallowed. Salt non-SMS keys; the salted key is
  // stored in the outbox payload, so offline retries stay idempotent.
  const baseKey = dedupeKey(deviceId, parsed);
  const key = opts.source === 'sms' ? baseKey : `${baseKey}|${Date.now().toString(36)}`;
  const payload = { deviceId, rawText: opts.rawText, dedupeKey: key, parsed, source: opts.source, category: opts.category, note: opts.note, tags: opts.tags };
  try {
    const { transaction, deduped } = await classify(payload);
    await upsertTxn(transaction);
    // Notify only for genuinely new transactions captured in the background —
    // never on re-scan, merges, or an in-app confirm.
    if (opts.notify && !deduped) await presentClassifyNotification(transaction);
    return { transaction, queued: false };
  } catch {
    // Offline / backend down — queue and retry on next flush.
    await queueOutbox(key, payload);
    return { transaction: null, queued: true };
  }
}

/**
 * Full pipeline for one raw bank SMS: filter → parse → classify → cache → notify.
 * Tracks SPENDING ONLY (credits are ignored). A message that looks financial but
 * can't be parsed is sent to the review queue rather than silently dropped.
 */
export async function ingestSms(rawText: string, sender?: string): Promise<void> {
  if (!isFinancialSms(rawText, sender)) return;
  const parsed = parseTransaction(rawText);
  if (!parsed || parsed.amount === undefined) {
    await addReview(rawText, sender, 'sms'); // looked financial, couldn't parse
    return;
  }
  if (parsed.direction !== 'debit') return; // spending only
  await submit(parsed, { source: 'sms', rawText, notify: true });
  // Every debit SMS already wakes JS in the background — refresh the widget here
  // so it stays fresh without any scheduled work.
  await refreshWidget().catch(() => {});
}

/**
 * Save a transaction the user confirmed on the add/share/review screen. The chosen
 * category is authoritative (server stores it, skips the LLM). No notification.
 */
export async function saveConfirmed(
  parsed: ParsedTxn,
  opts: { source: string; rawText?: string; category?: string; note?: string; tags?: string[] },
): Promise<{ transaction: TxnRow | null; queued: boolean }> {
  return submit({ ...parsed, direction: 'debit' }, {
    source: opts.source,
    rawText: opts.rawText ?? '',
    category: opts.category,
    note: opts.note,
    tags: opts.tags,
    notify: false,
  });
}

/** Retry any queued classify requests. Call on app foreground / connectivity regain. */
export async function flushOutbox(): Promise<number> {
  const items = await readOutbox();
  let sent = 0;
  for (const item of items) {
    try {
      const payload = JSON.parse(item.payload);
      const { transaction, deduped } = await classify(payload);
      await upsertTxn(transaction);
      // Notify only for background-captured SMS — not manual/share entries the
      // user already confirmed in-app.
      if (!deduped && (payload.source ?? 'sms') === 'sms') await presentClassifyNotification(transaction);
      await removeOutbox(item.dedupe_key);
      sent++;
    } catch {
      break; // still offline; stop and try again later
    }
  }
  return sent;
}

/** Pull backend changes into the local cache (source of truth = backend). */
export async function pullSync(): Promise<number> {
  const cursor = await getCursor();
  const { transactions, nextCursor } = await syncSince(cursor);
  for (const t of transactions) await upsertTxn(t);
  if (transactions.length) await setCursor(nextCursor);
  return transactions.length;
}

/**
 * On foreground: retry the offline queue and pull backend changes into the local
 * cache. Deliberately does NOT read the SMS inbox — only genuinely live incoming
 * SMS (via the native receiver), shared screenshots, and manual entries are
 * tracked. No history/backfill scanning.
 */
export async function syncBackend(): Promise<void> {
  await flushOutbox();
  await pullSync();
  await refreshWidget().catch(() => {}); // keep the home-screen widget current
}
