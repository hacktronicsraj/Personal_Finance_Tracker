import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchQuiz, gradeQuiz, type QuizCard } from '../src/api/client';
import { currentDecision, goHome, openInstagramSession } from '../src/focus';
import { FLASHCARDS_TO_PASS, makeMathChallenge, type GateReason, type MathChallenge } from '../src/gate';
import { Button, colors, DangerButton, H1, Muted } from '../src/ui';

const REASONS: GateReason[] = ['capped', 'math', 'flashcards', 'allow'];

/**
 * The Instagram gate. The accessibility service opens this (pft://gate?reason=…)
 * whenever Instagram is launched and today's requirements aren't met:
 *  • flashcards — answer 5 correctly (day-time). Any wrong answer → a fresh 5.
 *  • math       — one arithmetic problem (23:00–06:00). Wrong → a fresh one.
 *  • capped     — 30 min used today; a dead end until tomorrow, no override.
 * Clearing the gate grants a session and reopens Instagram.
 */
export default function GateScreen() {
  const params = useLocalSearchParams<{ reason?: string }>();
  const [reason, setReason] = useState<GateReason | null>(null);

  useEffect(() => {
    // The accessibility service is the enforcer and passes the reason it already
    // decided (pft://gate?reason=…) — trust it. Only recompute if it's missing.
    const fromService = REASONS.find((r) => r === params.reason);
    if (fromService) {
      setReason(fromService);
      return;
    }
    currentDecision()
      .then(({ decision }) => setReason(decision.allowed ? 'allow' : decision.reason))
      .catch(() => setReason('flashcards'));
  }, [params.reason]);

  if (!reason) {
    return (
      <SafeAreaView style={styles.screen}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (reason === 'flashcards') {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <FlashcardsGate />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={[styles.screen, styles.center]}>
      {reason === 'math' && <MathGate />}
      {reason === 'capped' && <CappedGate />}
      {reason === 'allow' && <AllowGate />}
    </SafeAreaView>
  );
}

async function grantAndLeave() {
  await openInstagramSession();
  // The app goes to the background as Instagram opens.
  setTimeout(() => (router.canGoBack() ? router.back() : goHome()), 400);
}

/* ─────────────────────────── Flashcards ─────────────────────────── */

function FlashcardsGate() {
  const [cards, setCards] = useState<QuizCard[] | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [empty, setEmpty] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setMsg('');
    setPicks({});
    try {
      const q = await fetchQuiz(FLASHCARDS_TO_PASS);
      if (q.cards.length < FLASHCARDS_TO_PASS) {
        setEmpty(true); // not enough cards imported yet → fall back to math
        return;
      }
      setCards(q.cards);
    } catch {
      setMsg('Could not load flashcards. Check your connection.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (empty) return <MathGate note="Import a ChatGPT chat to get flashcards. For now, solve this to open Instagram." />;

  async function submit() {
    if (!cards) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await gradeQuiz(picks);
      if (res.passed) {
        setMsg('Correct — opening Instagram.');
        await grantAndLeave();
      } else {
        setMsg(`${res.correct}/${res.total} right. All 5 must be correct — here's a fresh set.`);
        await load();
      }
    } catch {
      setMsg('Could not grade your answers. Try again.');
      setBusy(false);
    }
  }

  const allAnswered = !!cards && cards.every((c) => picks[c.id] != null);

  return (
    <ScrollView style={styles.flashScroll} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.emoji}>🧠</Text>
        <H1>Answer 5 to open Instagram</H1>
        <Muted style={styles.body}>All five correct, from what you've been learning. Any miss → a fresh set.</Muted>
      </View>

      {!cards ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        cards.map((c, i) => (
          <View key={c.id} style={styles.qcard}>
            <Text style={styles.qnum}>Question {i + 1} of {cards.length}</Text>
            <Text style={styles.question}>{c.question}</Text>
            <View style={{ gap: 8, marginTop: 12 }}>
              {c.options.map((opt, oi) => {
                const chosen = picks[c.id] === oi;
                return (
                  <Pressable
                    key={oi}
                    onPress={() => setPicks((p) => ({ ...p, [c.id]: oi }))}
                    style={[styles.option, chosen && styles.optionOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: chosen }}
                  >
                    <Text style={[styles.optionText, chosen && { color: colors.bg, fontWeight: '700' }]}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}

      {!!msg && <Text style={styles.msg}>{msg}</Text>}

      <View style={styles.actions}>
        <Button
          title={busy ? 'Working…' : allAnswered ? 'Check answers' : 'Answer all 5'}
          onPress={submit}
          disabled={busy || !allAnswered}
        />
        <Button title="Never mind" variant="ghost" onPress={goHome} />
      </View>
    </ScrollView>
  );
}

/* ─────────────────────────── Math (night) ─────────────────────────── */

function MathGate({ note }: { note?: string }) {
  const [c, setC] = useState<MathChallenge>(() => makeMathChallenge());
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit() {
    if (Number(answer) === c.answer) {
      setBusy(true);
      setMsg('Correct — opening Instagram.');
      await grantAndLeave();
    } else {
      setMsg('Not quite — here is a new one.');
      setC(makeMathChallenge());
      setAnswer('');
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>🌙</Text>
      <H1>Solve to open Instagram</H1>
      <Muted style={styles.body}>{note ?? "It's late. One problem and you're in."}</Muted>
      <Text style={styles.prompt}>{c.prompt} = ?</Text>
      <TextInput
        value={answer}
        onChangeText={setAnswer}
        keyboardType="number-pad"
        placeholder="answer"
        placeholderTextColor={colors.ghost}
        style={styles.input}
        editable={!busy}
        onSubmitEditing={submit}
        autoFocus
      />
      {!!msg && <Text style={styles.msg}>{msg}</Text>}
      <View style={styles.actions}>
        <Button title={busy ? 'Working…' : 'Unlock'} onPress={submit} disabled={busy || answer.trim() === ''} />
        <Button title="Never mind" variant="ghost" onPress={goHome} />
      </View>
    </View>
  );
}

/* ─────────────────────────── Capped / Allow ─────────────────────────── */

function CappedGate() {
  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>⛔</Text>
      <H1>That's 30 minutes today</H1>
      <Muted style={styles.body}>
        You've hit your daily Instagram limit. It unlocks again tomorrow — no override.
      </Muted>
      <View style={styles.actions}>
        <DangerButton title="Close Instagram" onPress={goHome} />
      </View>
    </View>
  );
}

function AllowGate() {
  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>✅</Text>
      <H1>You're in</H1>
      <Muted style={styles.body}>Instagram is open for this session.</Muted>
      <View style={styles.actions}>
        <Button title="OK" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : goHome())} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  flashScroll: { flex: 1, alignSelf: 'stretch' },
  scroll: { padding: 20, paddingBottom: 40 },
  header: { alignItems: 'center', marginBottom: 12 },
  card: {
    width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: 24, padding: 24,
    borderWidth: 1, borderColor: colors.hairline, alignItems: 'center',
  },
  emoji: { fontSize: 44, marginBottom: 8 },
  body: { textAlign: 'center', marginTop: 10, marginBottom: 4, fontSize: 14.5, lineHeight: 21 },
  qcard: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 16, marginTop: 12,
    borderWidth: 1, borderColor: colors.hairline,
  },
  qnum: { color: colors.ghost, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  question: { color: colors.text, fontSize: 15.5, fontWeight: '600', lineHeight: 22, marginTop: 6 },
  option: {
    backgroundColor: colors.surface2, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1, borderColor: colors.hairline,
  },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionText: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  prompt: { color: colors.text, fontSize: 40, fontWeight: '800', marginTop: 18, letterSpacing: 2 },
  input: {
    alignSelf: 'stretch', backgroundColor: colors.surface2, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: colors.text, fontSize: 22, textAlign: 'center', marginTop: 16, borderWidth: 1, borderColor: colors.hairline,
  },
  msg: { color: colors.amber, textAlign: 'center', marginTop: 14, fontSize: 13.5 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 20 },
});
