import { StyleSheet, Text, View } from 'react-native';
import { colors, mono } from '../ui';

/** Screen-owned header: bold title left, mono microcaps status right. */
export function AppHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <View style={styles.head}>
      <Text style={styles.title}>{title}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 14,
    paddingBottom: 14,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  meta: {
    fontFamily: mono,
    fontSize: 10,
    color: colors.ghost,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
});
