import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../ui';

/**
 * Ink-styled confirmation dialog — replaces the native Alert for destructive
 * actions so the confirm step stays inside the app's design language.
 * Renders nothing when `visible` is false.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  destructive = true,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        style={styles.backdrop}
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
      />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.row}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              android_ripple={{ color: destructive ? 'rgba(248,113,113,0.15)' : 'rgba(0,0,0,0.10)' }}
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.btnDanger : styles.btnPrimary,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={destructive ? styles.btnDangerText : styles.btnPrimaryText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline2,
    padding: 20,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  message: { color: colors.sub, fontSize: 13.5, lineHeight: 20, marginTop: 8 },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    overflow: 'hidden',
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.hairline2 },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  btnDanger: { backgroundColor: 'rgba(248,113,113,0.10)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.45)' },
  btnDangerText: { color: colors.neg, fontWeight: '700', fontSize: 14 },
  btnPrimary: { backgroundColor: colors.text },
  btnPrimaryText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
});
