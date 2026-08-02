import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, ripple } from '../ui';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Optional date + time picker for the add-expense screen. Pure JS (no native
 * dependency): a month calendar + HH:MM entry in a themed modal. `value` is null
 * when unset (the spend is recorded as "now"); picking a date/time sets it.
 */
export function WhenField({ value, onChange }: { value: Date | null; onChange: (d: Date | null) => void }) {
  const [open, setOpen] = useState(false);

  const display = value
    ? `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}, ${pad(value.getHours())}:${pad(value.getMinutes())}`
    : 'Now';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Date and time: ${display}. Tap to change`}
        android_ripple={ripple}
        style={({ pressed }) => [styles.field, pressed && { opacity: 0.7 }]}
      >
        <Text style={[styles.fieldText, !value && { color: colors.sub }]}>{display}</Text>
        {value && (
          <Pressable
            onPress={() => onChange(null)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Reset to now"
          >
            <Text style={styles.clear}>Now</Text>
          </Pressable>
        )}
      </Pressable>
      {open && (
        <PickerModal
          initial={value ?? new Date()}
          onClose={() => setOpen(false)}
          onApply={(d) => {
            onChange(d);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function PickerModal({
  initial,
  onClose,
  onApply,
}: {
  initial: Date;
  onClose: () => void;
  onApply: (d: Date) => void;
}) {
  const [viewY, setViewY] = useState(initial.getFullYear());
  const [viewM, setViewM] = useState(initial.getMonth());
  const [day, setDay] = useState(initial.getDate());
  const [hh, setHh] = useState(pad(initial.getHours()));
  const [mm, setMm] = useState(pad(initial.getMinutes()));

  const firstWeekday = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const stepMonth = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewM(m);
    setViewY(y);
    if (day > new Date(y, m + 1, 0).getDate()) setDay(new Date(y, m + 1, 0).getDate());
  };

  const apply = () => {
    const h = Math.min(23, Math.max(0, Number(hh) || 0));
    const mi = Math.min(59, Math.max(0, Number(mm) || 0));
    onApply(new Date(viewY, viewM, day, h, mi, 0, 0));
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" />
      <View style={styles.center} pointerEvents="box-none">
        <View style={styles.card}>
          {/* Month nav */}
          <View style={styles.monthRow}>
            <Pressable onPress={() => stepMonth(-1)} hitSlop={8} accessibilityLabel="Previous month" style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}>
              <ChevronLeftIcon size={16} />
            </Pressable>
            <Text style={styles.monthLabel}>{MONTHS[viewM]} {viewY}</Text>
            <Pressable onPress={() => stepMonth(1)} hitSlop={8} accessibilityLabel="Next month" style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}>
              <ChevronRightIcon size={16} />
            </Pressable>
          </View>

          {/* Weekday header */}
          <View style={styles.week}>
            {WEEKDAYS.map((d, i) => (
              <Text key={i} style={styles.weekday}>{d}</Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {cells.map((d, i) => (
              <View key={i} style={styles.cell}>
                {d != null && (
                  <Pressable
                    onPress={() => setDay(d)}
                    accessibilityRole="button"
                    accessibilityLabel={`${d} ${MONTHS[viewM]}`}
                    accessibilityState={{ selected: d === day }}
                    style={({ pressed }) => [styles.dayBtn, d === day && styles.dayBtnSel, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.dayText, d === day && styles.dayTextSel]}>{d}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>

          {/* Time */}
          <View style={styles.timeRow}>
            <Text style={styles.timeLabel}>Time</Text>
            <View style={styles.timeInputs}>
              <TextInput
                value={hh}
                onChangeText={(t) => setHh(t.replace(/\D/g, '').slice(0, 2))}
                onBlur={() => setHh(pad(Math.min(23, Number(hh) || 0)))}
                keyboardType="number-pad"
                maxLength={2}
                accessibilityLabel="Hour"
                style={styles.timeInput}
              />
              <Text style={styles.colon}>:</Text>
              <TextInput
                value={mm}
                onChangeText={(t) => setMm(t.replace(/\D/g, '').slice(0, 2))}
                onBlur={() => setMm(pad(Math.min(59, Number(mm) || 0)))}
                keyboardType="number-pad"
                maxLength={2}
                accessibilityLabel="Minute"
                style={styles.timeInput}
              />
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && { opacity: 0.6 }]}>
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={apply} accessibilityRole="button" accessibilityLabel="Apply date and time" android_ripple={{ color: 'rgba(0,0,0,0.1)' }} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.8 }]}>
              <Text style={styles.btnPrimaryText}>Set</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 12,
    minHeight: 46,
    overflow: 'hidden',
  },
  fieldText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  clear: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.hairline2,
    padding: 16,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  monthLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', color: colors.ghost, fontSize: 11, fontWeight: '700', paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', padding: 2 },
  dayBtn: { width: '100%', height: '100%', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dayBtnSel: { backgroundColor: colors.text },
  dayText: { color: colors.sub, fontSize: 13.5, fontWeight: '600' },
  dayTextSel: { color: colors.bg, fontWeight: '800' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 4 },
  timeLabel: { color: colors.ghost, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  timeInputs: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.hairline2,
    borderRadius: 10,
    width: 52,
    paddingVertical: 8,
    textAlign: 'center',
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  colon: { color: colors.sub, fontSize: 18, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, overflow: 'hidden' },
  btnGhost: { borderWidth: 1, borderColor: colors.hairline2 },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  btnPrimary: { backgroundColor: colors.text },
  btnPrimaryText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
});
