import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { flashcardCount } from '../src/api/client';
import { AppHeader } from '../src/components/AppHeader';
import {
  focusStatus,
  instagramUsageToday,
  openAccessibilitySettings,
  openUsageAccessSettings,
  requestAdmin,
  type FocusStatus,
} from '../src/focus';
import { DAILY_CAP_MIN, FLASHCARDS_TO_PASS } from '../src/gate';
import { Button, Card, colors, H2, Muted, Screen } from '../src/ui';

function StatusRow({ label, ok, hint, action, onAction }: {
  label: string; ok: boolean; hint: string; action?: string; onAction?: () => void;
}) {
  return (
    <View style={styles.statusRow}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[styles.dot, { backgroundColor: ok ? colors.accent : colors.neg }]} />
          <Text style={{ color: colors.text, fontSize: 14.5, fontWeight: '600' }}>{label}</Text>
        </View>
        <Muted style={{ marginTop: 3 }}>{hint}</Muted>
      </View>
      {!ok && action && <Button title={action} variant="ghost" onPress={onAction!} />}
    </View>
  );
}

export default function FocusScreen() {
  const [status, setStatus] = useState<FocusStatus | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const [cards, setCards] = useState<number | null>(null);

  const reload = useCallback(() => {
    focusStatus().then(setStatus).catch(() => {});
    instagramUsageToday().then(setUsage).catch(() => setUsage(null));
    flashcardCount().then(setCards).catch(() => setCards(null));
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  if (!status) return <Screen><AppHeader title="Focus" /><Muted>Loading…</Muted></Screen>;

  if (!status.available) {
    return (
      <Screen>
        <AppHeader title="Focus" />
        <Card>
          <H2>Not in this build</H2>
          <Muted style={{ marginTop: 6 }}>
            Focus Guard (Instagram limits + uninstall protection) needs the native build of the app. Rebuild and reinstall
            the APK to enable it.
          </Muted>
        </Card>
      </Screen>
    );
  }

  const used = usage ?? 0;
  const left = Math.max(0, DAILY_CAP_MIN - used);
  const pct = Math.min(1, used / DAILY_CAP_MIN);
  const capped = used >= DAILY_CAP_MIN;
  const active = status.accessibility && status.usageAccess;

  return (
    <Screen>
      <AppHeader title="Focus" meta={active ? 'active' : 'setup'} />

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <H2>Instagram today</H2>
          <Text style={{ color: capped ? colors.neg : colors.accent, fontSize: 22, fontWeight: '800' }}>
            {used}/{DAILY_CAP_MIN}m
          </Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: capped ? colors.neg : colors.accent }]} />
        </View>
        <Muted style={{ marginTop: 8 }}>
          {capped
            ? 'Daily limit reached. Instagram is blocked until tomorrow — no override.'
            : `${left} min left today. Each open needs ${FLASHCARDS_TO_PASS} flashcards right (a math problem 11pm–6am).`}
        </Muted>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <H2>Flashcards</H2>
          <Text style={{ color: colors.accent, fontSize: 22, fontWeight: '800' }}>{cards ?? '—'}</Text>
        </View>
        <Muted style={{ marginTop: 6 }}>
          {cards && cards >= FLASHCARDS_TO_PASS
            ? 'Built from the ChatGPT chats you share into this app.'
            : `Fewer than ${FLASHCARDS_TO_PASS} cards. Share a ChatGPT conversation (⋯ → Share → Finance Tracker) to add more. Until then, opening Instagram falls back to a math problem.`}
        </Muted>
      </Card>

      <Text style={styles.section}>Permissions</Text>
      <Card>
        <StatusRow
          label="Accessibility service"
          ok={status.accessibility}
          hint="Lets the app notice when Instagram opens and step in. Required."
          action="Enable"
          onAction={openAccessibilitySettings}
        />
        <View style={styles.divider} />
        <StatusRow
          label="Usage access"
          ok={status.usageAccess}
          hint="Counts your Instagram minutes so the 30-minute cap works. Required."
          action="Grant"
          onAction={openUsageAccessSettings}
        />
        <View style={styles.divider} />
        <StatusRow
          label="Uninstall protection"
          ok={status.adminActive}
          hint="Makes the app a device admin so it can’t be uninstalled from the phone. Remove later with adb."
          action="Turn on"
          onAction={() =>
            Alert.alert(
              'Uninstall protection',
              'The app becomes a device admin. To uninstall it afterwards you’ll need to run:\n\nadb uninstall com.personal.financetracker\n\nContinue?',
              [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => requestAdmin() }],
            )
          }
        />
      </Card>

      <Muted style={{ textAlign: 'center', marginTop: 12, marginBottom: 24, fontSize: 11 }}>
        The guard is always on — there’s no off switch. The 30-minute cap and the flashcards are both hard rules.
      </Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.sub, fontWeight: '700', fontSize: 12.5, marginTop: 12, paddingHorizontal: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 10 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surface2, marginTop: 12, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
});
