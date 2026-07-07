import * as ImageManipulator from 'expo-image-manipulator';
import { extractImage } from './api/client';
import { parsePayment } from './parse/parser';
import type { ParsedTxn } from './parse/types';

/**
 * Turn a shared payment SCREENSHOT (Google Pay shares an image, not text) into a
 * ParsedTxn by compressing it and letting the backend vision model read the amount
 * and payee off the pixels. Returns null if nothing usable could be read.
 */
export async function screenshotToPayment(uri: string): Promise<ParsedTxn | null> {
  // The share sheet sometimes hands back a bare filesystem path — give it a scheme.
  const src = /^[a-z]+:\/\//i.test(uri) ? uri : `file://${uri}`;
  const out = await ImageManipulator.manipulateAsync(src, [{ resize: { width: 1080 } }], {
    compress: 0.6,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) return null;
  const extracted = await extractImage(out.base64, 'image/jpeg');
  if (!extracted || extracted.amount == null) return null;
  return {
    amount: extracted.amount,
    direction: extracted.direction,
    currency: extracted.currency || 'INR',
    merchant: extracted.merchant ?? undefined,
    occurredAt: extracted.occurredAt ?? undefined,
  };
}

/** Parse shared free-text (PhonePe/Paytm receipts). */
export function textToPayment(text: string): ParsedTxn | null {
  return parsePayment(text);
}
