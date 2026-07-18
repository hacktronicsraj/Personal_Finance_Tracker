import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getSettings } from './settings';

/**
 * Download the server's CSV export to the cache dir (authed) and hand it to the
 * Android share sheet. Doubles as a backup. Throws on connectivity/auth failure
 * so the caller can show a retry.
 */
export async function exportCsv(range?: { from?: string; to?: string }): Promise<void> {
  const { backendUrl, apiToken } = await getSettings();
  if (!backendUrl) throw new Error('Backend URL not configured');

  const qs = new URLSearchParams();
  if (range?.from) qs.set('from', range.from);
  if (range?.to) qs.set('to', range.to);
  const url = `${backendUrl}/export${qs.toString() ? `?${qs}` : ''}`;

  const stamp = new Date().toISOString().slice(0, 10);
  const fileUri = `${FileSystem.cacheDirectory}transactions-${stamp}.csv`;
  const res = await FileSystem.downloadAsync(url, fileUri, {
    headers: apiToken ? { authorization: `Bearer ${apiToken}` } : {},
  });
  if (res.status !== 200) throw new Error(`Export failed (${res.status})`);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(res.uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export transactions',
      UTI: 'public.comma-separated-values-text',
    });
  }
}
