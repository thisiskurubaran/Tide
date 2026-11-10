import { Icon } from '../../components/Icon';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { editorThemes } from '../../theme/editor';
import { makeStyles, useColorScheme, useColors } from '../../theme/theme';
import { radius, spacing } from '../../theme/tokens';
import type { EditorTheme } from '../../theme/editor';
import { extensionsStore, useExtensions } from '../state';
import { colorThemes } from './catalog';

// Picks the editor and terminal theme. Opened from the command palette and from Settings.
export function ThemePicker({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const scheme = useColorScheme();
  const chosen = useExtensions((s) => s.prefs.theme);
  const fileIcons = useExtensions((s) => s.prefs.fileIcons);
  const { setPref } = extensionsStore.getState();
  const options = [{ id: null, name: 'Tide (follows Light or Dark)', editor: editorThemes[scheme] }, ...colorThemes];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="title">Color theme</Text>
      <ScrollView style={styles.list}>
        {options.map((t) => {
          const selected = t.id === chosen;
          return (
            <Pressable
              key={t.id ?? 'default'}
              testID={`theme-${t.id ?? 'default'}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setPref('theme', t.id)}
              style={({ pressed }) => [styles.row, (selected || pressed) && { backgroundColor: colors.secondary }]}
            >
              <Swatch theme={t.editor} />
              <Text style={styles.name}>{t.name}</Text>
              {selected && <Icon name="check" size={18} color={colors.brand} />}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.row}>
        <Text style={styles.name}>File icons</Text>
        <Switch testID="file-icons" value={fileIcons} onValueChange={(v) => setPref('fileIcons', v)} />
      </View>
    </Sheet>
  );
}

// A few lines of fake code in the theme's colors.
function Swatch({ theme }: { theme: EditorTheme }) {
  const styles = useStyles();
  const bar = (color: string, width: number) => <View style={[styles.bar, { backgroundColor: color, width }]} />;
  return (
    <View style={[styles.swatch, { backgroundColor: theme.background, borderColor: theme.gutterBorder }]}>
      <View style={styles.line}>
        {bar(theme.syntax.keyword, 10)}
        {bar(theme.syntax.function, 14)}
      </View>
      <View style={styles.line}>
        {bar(theme.syntax.string, 16)}
        {bar(theme.syntax.number, 6)}
      </View>
      <View style={styles.line}>{bar(theme.syntax.comment, 20)}</View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 420 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md },
  name: { flex: 1 },
  swatch: { width: 44, height: 32, borderRadius: radius.sm, borderWidth: 1, padding: 4, gap: 3, justifyContent: 'center' },
  line: { flexDirection: 'row', gap: 3 },
  bar: { height: 4, borderRadius: 2 },
}));
