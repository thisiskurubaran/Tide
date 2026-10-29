import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Action, ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import type { IconName } from '../../components/Button';
import { PromptSheet } from '../../components/PromptSheet';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { DEFAULT_EDITOR_KEYS, EDITOR_KEYS, keyFace, LANGUAGE_PRESETS, TERMINAL_KEYS, text } from './catalog';
import { EditorLayout, keyBarStore, useKeyBar } from './store';

const LAYOUTS: { value: EditorLayout; label: string }[] = [
  { value: 'default', label: 'All files' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
];

// Settings, Key bar: which keys sit above the keyboard, for the editor (per
// language if wanted) and the terminal.
export function KeyBarSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [bar, setBar] = useState<'editor' | 'terminal'>('editor');
  const [layout, setLayout] = useState<EditorLayout>('default');
  const [adding, setAdding] = useState(false);
  const [typing, setTyping] = useState(false);
  const editor = useKeyBar((s) => s.editor);
  const terminal = useKeyBar((s) => s.terminal);
  const store = keyBarStore.getState();

  const own = bar === 'editor' ? editor[layout] : terminal;
  // A language without its own list shows (and starts from) the default one.
  const keys = bar === 'editor' ? (own ?? editor.default ?? DEFAULT_EDITOR_KEYS) : terminal;
  const inherited = bar === 'editor' && layout !== 'default' && !own;
  const save = (next: string[] | null) => (bar === 'editor' ? store.setEditor(layout, next) : store.setTerminal(next));
  const move = (i: number, by: number) => {
    const next = [...keys];
    const [k] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, k);
    save(next);
  };
  const preset = bar === 'editor' && layout !== 'default' ? LANGUAGE_PRESETS[layout] : undefined;
  const catalog = bar === 'editor' ? EDITOR_KEYS : TERMINAL_KEYS;
  const addable: Action[] = catalog
    .filter((k) => !keys.includes(k.id))
    .map((k) => ({ label: k.a11y, icon: (k.icon ?? 'plus-square') as IconName, onPress: () => save([...keys, k.id]) }));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} testID="back" />
        <Text variant="title">Key bar</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Segmented<'editor' | 'terminal'>
          testID="keybar-target"
          value={bar}
          onChange={setBar}
          options={[
            { value: 'editor', label: 'Editor' },
            { value: 'terminal', label: 'Terminal' },
          ]}
        />
        {bar === 'editor' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {LAYOUTS.map((l) => {
              const on = l.value === layout;
              return (
                <Pressable
                  key={l.value}
                  testID={`keybar-layout-${l.value}`}
                  onPress={() => setLayout(l.value)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text variant="label" style={{ color: on ? colors.foreground : colors.mutedForeground }}>
                    {l.label}
                    {l.value !== 'default' && editor[l.value] ? ' •' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {inherited && <Text variant="muted">Uses the keys for all files. Change anything below to give this language its own.</Text>}

        <View style={styles.card}>
          {keys.map((id, i) => {
            const face = keyFace(id, bar);
            if (!face) return null;
            return (
              <View key={`${i}-${id}`} style={styles.row} testID={`keybar-key-${i}`}>
                <View style={styles.face}>
                  {face.icon ? (
                    <Feather name={face.icon as IconName} size={16} color={colors.foreground} />
                  ) : (
                    <Text style={styles.faceLabel}>{face.label}</Text>
                  )}
                </View>
                <Text style={styles.flex} numberOfLines={1}>
                  {face.a11y}
                </Text>
                <IconButton icon="arrow-up" label={`Move ${face.a11y} left`} onPress={() => move(i, -1)} testID={`keybar-up-${i}`} />
                <IconButton icon="arrow-down" label={`Move ${face.a11y} right`} onPress={() => move(i, 1)} testID={`keybar-down-${i}`} />
                <IconButton
                  icon="x"
                  label={`Remove ${face.a11y}`}
                  onPress={() => save(keys.filter((_, j) => j !== i))}
                  testID={`keybar-remove-${i}`}
                />
              </View>
            );
          })}
          {keys.length === 0 && <Text variant="muted" style={styles.empty}>No keys. Add some below.</Text>}
        </View>

        <View style={styles.actions}>
          <Button title="Add key" variant="outline" icon="plus" onPress={() => setAdding(true)} disabled={!addable.length} testID="keybar-add" />
          <Button title="Add text" variant="outline" icon="type" onPress={() => setTyping(true)} testID="keybar-add-text" />
          {preset && <Button title="Use preset" variant="outline" icon="zap" onPress={() => save(preset)} testID="keybar-preset" />}
          <Button title="Reset" variant="outline" icon="rotate-ccw" onPress={() => save(null)} testID="keybar-reset" />
        </View>
        <Text variant="muted">Text keys type their text, so they can hold a symbol or a snippet such as =&gt; or console.log(.</Text>
      </ScrollView>

      <ActionSheet title={adding ? 'Add key' : null} actions={addable} onClose={() => setAdding(false)} />
      <PromptSheet
        visible={typing}
        title="Add a text key"
        placeholder="e.g. => or self."
        confirmLabel="Add"
        onClose={() => setTyping(false)}
        onSubmit={async (value) => {
          if (!value) throw new Error('Type the text for the key');
          if (value.length > 40) throw new Error('Keep it under 40 characters');
          save([...keys, text(value)]);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  content: { padding: spacing.md, gap: spacing.md },
  chips: { gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth, borderColor: colors.border },
  chipOn: { backgroundColor: colors.secondary, borderColor: colors.brand },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48, borderBottomWidth: borderWidth, borderColor: colors.border, marginBottom: -borderWidth },
  face: { minWidth: 36, height: 30, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.secondary },
  faceLabel: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.sm, color: colors.foreground },
  flex: { flex: 1 },
  empty: { padding: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));
