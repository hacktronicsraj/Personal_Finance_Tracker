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
 * "Ink" design tokens.
 * Monochrome foundation (true black → white) with a single restrained EMERALD
 * accent used only for positive states + the active nav item. Primary actions
 * (buttons, FAB, selected pills) are WHITE. Category color is data — a small dot,
 * never a fill or a tint.
 */
export const colors = {
  bg: '#000000',
  surface: '#0A0A0C',
  surface2: '#121214',
  surface3: '#1A1A1E',
  hairline: '#222226',
  hairline2: '#2E2E34',
  divider: '#16161A',
  text: '#FAFAFA',
  sub: '#A1A1AA', // text-2
  ghost: '#6B6B73', // text-3
  faint: '#444448', // text-4 — hints / disabled
  accent: '#34D399', // emerald — positive + active only
  accentPress: '#10B981',
  accentDim: 'rgba(52,211,153,0.12)',
  accentLine: 'rgba(52,211,153,0.32)',
  onAccent: '#000000',
  pos: '#34D399',
  neg: '#F87171',
  amber: '#F59E0B',
  amberDim: 'rgba(245,158,11,0.10)',
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
      <Text style={{ color: colors.sub, fontWeight: '600' }}>₹</Text>
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
        <Pressable
          onPress={onAction}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={action}
          style={({ pressed }) => pressed && { opacity: 0.5 }}
        >
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Subtle press ripple used across surfaces (Android-only app → native feel). */
export const ripple = { color: 'rgba(255,255,255,0.08)' } as const;

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
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      android_ripple={variant === 'primary' ? { color: 'rgba(0,0,0,0.10)' } : ripple}
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

/** Red-styled ghost button for destructive actions like delete. */
export function DangerButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      android_ripple={{ color: 'rgba(248,113,113,0.12)' }}
      style={({ pressed }) => [
        styles.btn,
        styles.btnDanger,
        pressed && { opacity: 0.6 },
      ]}
    >
      <Text style={styles.btnDangerText}>{title}</Text>
    </Pressable>
  );
}

/** Category pill: category dot + name. Selected = white fill (Ink primary), not the hue. */
export function CategoryPill({ name, selected, onPress }: { name: string; selected?: boolean; onPress?: () => void }) {
  const c = categoryColor(name);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: !!selected }}
      android_ripple={ripple}
      style={({ pressed }) => [styles.pill, selected && styles.pillSel, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.pillDot, { backgroundColor: c, opacity: selected ? 0.7 : 1 }]} />
      <Text style={[styles.pillText, selected && styles.pillTextSel]}>{name}</Text>
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
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
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
  btn: { paddingVertical: 16, paddingHorizontal: 18, borderRadius: 16, alignItems: 'center', overflow: 'hidden' },
  btnPrimary: { backgroundColor: colors.text },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.hairline2 },
  btnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)' },
  btnDangerText: { color: colors.neg, fontWeight: '700', fontSize: 15 },
  btnText: { color: colors.onAccent, fontWeight: '700', fontSize: 15 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline2,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  pillSel: { backgroundColor: colors.text, borderColor: colors.text },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { color: colors.sub, fontSize: 12.5, fontWeight: '600' },
  pillTextSel: { color: colors.bg },
});
