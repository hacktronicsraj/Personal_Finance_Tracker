import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { importFlashcards } from '../src/api/client';
import { Button, colors, H1, Muted } from '../src/ui';

/**
 * Lands here when a ChatGPT share link is shared into the app. The phone fetches
 * the conversation HTML itself (ChatGPT blocks Cloudflare Worker egress) and the
 * backend turns it into MCQ flashcards. Those cards then feed the Instagram gate.
 */
export default function FlashcardImport() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working');
  const [msg, setMsg] = useState('Reading your ChatGPT conversation…');
  const [detail, setDetail] = useState<{ added: number; total: number; title?: string; alreadyImported?: boolean } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !url) return;
    started.current = true;
    importFlashcards(String(url))
      .then((res) => {
        setDetail(res);
        setStatus('done');
      })
      .catch((e) => {
        setMsg(String(e?.message ?? e) || 'Could not import this conversation.');
        setStatus('error');
      });
  }, [url]);

  return (
    <SafeAreaView style={styles.screen}>
      {status === 'working' && (
        <View style={{ alignItems: 'center', gap: 16 }}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{msg}</Text>
          <Muted style={{ textAlign: 'center' }}>Making flashcards from what you learned.</Muted>
        </View>
      )}

      {status === 'done' && detail && (
        <View style={{ alignItems: 'center', gap: 12, padding: 8 }}>
          <Text style={{ fontSize: 44 }}>🧠</Text>
          <H1>{detail.alreadyImported ? 'Already added' : `${detail.added} new cards`}</H1>
          {!!detail.title && <Muted style={{ textAlign: 'center' }}>{detail.title}</Muted>}
          <Muted style={{ textAlign: 'center' }}>
            {detail.alreadyImported
              ? 'This conversation was imported before.'
              : `You now have ${detail.total} flashcards feeding the Instagram gate.`}
          </Muted>
          <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
            <Button title="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          </View>
        </View>
      )}

      {status === 'error' && (
        <View style={{ alignItems: 'center', gap: 16, padding: 24 }}>
          <Text style={{ fontSize: 40 }}>🧠</Text>
          <Muted style={{ textAlign: 'center' }}>{msg}</Muted>
          <Button title="Close" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
