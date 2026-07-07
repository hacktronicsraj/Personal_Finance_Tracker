import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categoryColor, formatNum } from './config';

/**
 * AMOLED design tokens.
 * True-black ground; surfaces one step up with hairline borders instead of
 * shadows; a single indigo accent marks everything interactive; category color
 * appears only as data (dots, tiles, bars, slices).
 */
export const colors = {
  bg: '#000000',
  surface: '#0E0F13',
  surface2: '#15161C',
  hairline: '#1E2029',
  divider: '#14151B',
  text: '#F4F5F9',
  sub: '#9BA0B2',
  ghost: '#5D6172',
  accent: '#7C83FF',
  accentDim: 'rgba(124,131,255,0.16)',
  onAccent: '#0B0B12',
  pos: '#3ADC97',
  neg: '#FF7A7A',
  amber: '#FBBF24',
  amberDim: 'rgba(245,158,11,0.14)',
};

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll}>{children}</ScrollView>
      ) : (
        <View style={styles.scroll}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}
export function Muted({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

/** Mono microcaps label — SPENT THIS MONTH, SYNCED · 21:47. */
export function Kicker({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.kicker, style]}>{children}</Text>;
}

/** Money display type: heavy tabular numerals, ₹ picked out in accent. */
export function Money({ value, size = 40, sign }: { value: number; size?: number; sign?: '−' | '+' }) {
  return (
    <Text style={[styles.money, { fontSize: size }]}>
      {sign ? `${sign} ` : ''}
      <Text style={{ color: colors.accent }}>₹</Text>
      {formatNum(value)}
    </Text>
  );
}

/** Small status pill: delta, guesses, review flags. */
export function Chip({ label, bg, color }: { label: string; bg?: string; color?: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg ?? colors.surface2 }]}>
      <Text style={[styles.chipText, { color: color ?? colors.sub }]}>{label}</Text>
    </View>
  );
}

export function SectionLabel({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' ? styles.btnPrimary : styles.btnGhost,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.btnText, variant === 'ghost' && { color: colors.text }]}>{title}</Text>
    </Pressable>
  );
}

/** Category pill: colored dot + name; selected = filled with the category hue. */
export function CategoryPill({ name, selected, onPress }: { name: string; selected?: boolean; onPress?: () => void }) {
  const c = categoryColor(name);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, selected && { backgroundColor: c, borderColor: c }]}
    >
      {!selected && <View style={[styles.pillDot, { backgroundColor: c }]} />}
      <Text style={[styles.pillText, selected && { color: colors.onAccent }]}>{name}</Text>
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export const inputStyle: TextStyle = {
  backgroundColor: colors.bg,
  borderWidth: 1,
  borderColor: colors.hairline,
  borderRadius: 13,
  paddingHorizontal: 13,
  paddingVertical: 12,
  color: colors.text,
  fontSize: 14,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  h1: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  muted: { color: colors.sub, fontSize: 13, lineHeight: 19 },
  kicker: {
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.ghost,
    textTransform: 'uppercase',
  },
  money: {
    color: colors.text,
    fontWeight: '800',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  chipText: { fontSize: 10.5, fontWeight: '600' },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: -4,
    paddingHorizontal: 2,
  },
  sectionTitle: { color: colors.sub, fontSize: 12.5, fontWeight: '700' },
  sectionAction: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  btn: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.hairline },
  btnText: { color: colors.onAccent, fontWeight: '800', fontSize: 14 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#262834',
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: colors.sub, fontSize: 11.5, fontWeight: '600' },
});
