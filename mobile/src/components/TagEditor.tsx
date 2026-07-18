import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../ui';
import { CloseIcon } from './icons';

/**
 * Tag chip editor — selected tags render as removable chips; typing adds a tag
 * on submit or comma, with autocomplete drawn from previously-used tags. Optional
 * field, controlled via `value`/`onChange`.
 */
export function TagEditor({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add a tag…',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const tag = raw.trim().replace(/,+$/, '').trim();
    if (!tag) return;
    if (!value.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onChangeText = (text: string) => {
    // Comma commits the current token (supports "trip, work" style entry).
    if (text.includes(',')) add(text);
    else setDraft(text);
  };

  const matches = useMemo(() => {
    const d = draft.trim().toLowerCase();
    const selected = new Set(value.map((t) => t.toLowerCase()));
    return suggestions
      .filter((s) => !selected.has(s.toLowerCase()) && (d === '' || s.toLowerCase().includes(d)))
      .slice(0, 8);
  }, [draft, suggestions, value]);

  return (
    <View>
      <View style={styles.chips}>
        {value.map((tag) => (
          <Pressable
            key={tag}
            onPress={() => remove(tag)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${tag}`}
            style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.chipText}>{tag}</Text>
            <CloseIcon size={10} color={colors.accent} />
          </Pressable>
        ))}
        <TextInput
          value={draft}
          onChangeText={onChangeText}
          onSubmitEditing={() => add(draft)}
          placeholder={value.length ? '' : placeholder}
          placeholderTextColor={colors.ghost}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="done"
          style={styles.input}
        />
      </View>
      {matches.length > 0 && (
        <View style={styles.suggest}>
          {matches.map((s) => (
            <Pressable
              key={s}
              onPress={() => add(s)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Add tag ${s}`}
              style={({ pressed }) => [styles.sChip, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.sChipText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: colors.accentDim,
    borderWidth: 1,
    borderColor: colors.accentLine,
  },
  chipText: { color: colors.accent, fontSize: 12.5, fontWeight: '600' },
  input: {
    flexGrow: 1,
    minWidth: 90,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 6,
  },
  suggest: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 9 },
  sChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline2,
    backgroundColor: colors.surface2,
  },
  sChipText: { color: colors.sub, fontSize: 12, fontWeight: '500' },
});
