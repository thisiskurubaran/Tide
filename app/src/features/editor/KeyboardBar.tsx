import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { IconName } from '../../components/Button';
import { Text } from '../../components/Text';
import { borderWidth, colors, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import type { EditorKey, ToEditor } from './bridge';

export const KEYBOARD_BAR_HEIGHT = 44;

type Key = { label: string; msg: ToEditor; a11y: string };

const char = (c: string, a11y: string): Key => ({ label: c, msg: { type: 'insert', text: c }, a11y });
const key = (label: string, k: EditorKey, a11y: string): Key => ({ label, msg: { type: 'key', key: k }, a11y });

const KEYS: Key[] = [
  key('⇥', 'tab', 'Tab'),
  char('{', 'Open brace'),
  char('}', 'Close brace'),
  char('(', 'Open parenthesis'),
  char(')', 'Close parenthesis'),
  char('[', 'Open bracket'),
  char(']', 'Close bracket'),
  char(';', 'Semicolon'),
  char(':', 'Colon'),
  char('"', 'Double quote'),
  char("'", 'Single quote'),
  char('=', 'Equals'),
  char('<', 'Less than'),
  char('>', 'Greater than'),
  char('/', 'Slash'),
  char('\\', 'Backslash'),
];

const ARROWS: { icon: IconName; key: EditorKey; a11y: string }[] = [
  { icon: 'arrow-left', key: 'left', a11y: 'Cursor left' },
  { icon: 'arrow-up', key: 'up', a11y: 'Cursor up' },
  { icon: 'arrow-down', key: 'down', a11y: 'Cursor down' },
  { icon: 'arrow-right', key: 'right', a11y: 'Cursor right' },
];

const ACTIONS: { icon: IconName; msg: ToEditor; a11y: string }[] = [
  { icon: 'corner-up-left', msg: { type: 'undo' }, a11y: 'Undo' },
  { icon: 'corner-up-right', msg: { type: 'redo' }, a11y: 'Redo' },
  { icon: 'search', msg: { type: 'find' }, a11y: 'Find' },
];

export function KeyboardBar({ send }: { send(msg: ToEditor): void }) {
  return (
    <View style={styles.bar} testID="keyboard-bar">
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys}>
        {ARROWS.map((a) => (
          <Pressable key={a.key} accessibilityLabel={a.a11y} onPress={() => send({ type: 'key', key: a.key })} style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
            <Feather name={a.icon} size={16} color={colors.foreground} />
          </Pressable>
        ))}
        <View style={styles.divider} />
        {KEYS.map((k) => (
          <Pressable key={k.a11y} accessibilityLabel={k.a11y} onPress={() => send(k.msg)} style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
            <Text style={styles.label}>{k.label}</Text>
          </Pressable>
        ))}
        <View style={styles.divider} />
        {ACTIONS.map((a) => (
          <Pressable key={a.a11y} accessibilityLabel={a.a11y} onPress={() => send(a.msg)} style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
            <Feather name={a.icon} size={16} color={colors.foreground} />
          </Pressable>
        ))}
      </ScrollView>
      <Pressable accessibilityLabel="Hide keyboard" onPress={() => send({ type: 'blur' })} style={({ pressed }) => [styles.hide, pressed && styles.pressed]}>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: KEYBOARD_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopWidth: borderWidth,
    borderColor: colors.border,
  },
  keys: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  key: {
    minWidth: 36,
    height: 32,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.secondary,
  },
  pressed: { backgroundColor: colors.border },
  label: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.md, color: colors.foreground },
  divider: { width: borderWidth, height: 20, backgroundColor: colors.border, marginHorizontal: spacing.xs },
  hide: {
    width: KEYBOARD_BAR_HEIGHT,
    height: KEYBOARD_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: borderWidth,
    borderColor: colors.border,
  },
});
