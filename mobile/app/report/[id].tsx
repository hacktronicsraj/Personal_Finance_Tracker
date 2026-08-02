import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { fetchReportHtml, generateReport } from '../../src/api/client';
import { getMeta, setMeta } from '../../src/db/database';
import { Button, colors, Loading, Muted, Screen } from '../../src/ui';

/**
 * Renders a report's server-built HTML in a WebView. `id` is a report id or the
 * literal 'latest'; for 'latest' an optional `type` (weekly|monthly) scopes which
 * kind is fetched — so the weekly notification never opens a monthly report. The
 * latest HTML is cached locally (per type) so it survives offline. If nothing
 * loads, a retry triggers server-side generation of that type.
 */
export default function ReportDetail() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: 'weekly' | 'monthly' }>();
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [generating, setGenerating] = useState(false);

  const cacheKey = `report.latest.${type ?? 'any'}.html`;

  const load = useCallback(async () => {
    setState('loading');
    try {
      const h = await fetchReportHtml(id, type);
      setHtml(h);
      if (id === 'latest') await setMeta(cacheKey, h);
      setState('ok');
    } catch {
      if (id === 'latest') {
        const cached = await getMeta(cacheKey);
        if (cached) {
          setHtml(cached);
          setState('ok');
          return;
        }
      }
      setState('error');
    }
  }, [id, type, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function regenerate() {
    setGenerating(true);
    try {
      await generateReport(type === 'monthly' ? 'monthly' : 'weekly');
      await load();
    } catch {
      /* stay on the error state */
    } finally {
      setGenerating(false);
    }
  }

  if (state === 'loading') return <Screen><Loading /></Screen>;
  if (state === 'error')
    return (
      <Screen>
        <Muted>No report yet, or the server couldn’t be reached.</Muted>
        <View style={{ height: 12 }} />
        <Button
          title={generating ? 'Generating…' : `Generate ${type === 'monthly' ? 'this month’s' : 'this week’s'} report`}
          onPress={regenerate}
          disabled={generating}
        />
      </Screen>
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <WebView
        originWhitelist={['*']}
        source={{ html: html ?? '' }}
        style={{ flex: 1, backgroundColor: colors.bg }}
      />
    </View>
  );
}
