import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { fetchReportHtml, generateReport } from '../../src/api/client';
import { getMeta, setMeta } from '../../src/db/database';
import { Button, colors, Loading, Muted, Screen } from '../../src/ui';

const LATEST_CACHE_KEY = 'report.latest.html';

/**
 * Renders a weekly report's server-built HTML in a WebView. For 'latest' it caches
 * the HTML locally so it survives offline. If nothing loads (no report yet, or
 * generation failed), shows a retry that triggers server-side generation.
 */
export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [html, setHtml] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const h = await fetchReportHtml(id);
      setHtml(h);
      if (id === 'latest') await setMeta(LATEST_CACHE_KEY, h);
      setState('ok');
    } catch {
      if (id === 'latest') {
        const cached = await getMeta(LATEST_CACHE_KEY);
        if (cached) {
          setHtml(cached);
          setState('ok');
          return;
        }
      }
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function regenerate() {
    setGenerating(true);
    try {
      await generateReport();
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
          title={generating ? 'Generating…' : 'Generate this week’s report'}
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
