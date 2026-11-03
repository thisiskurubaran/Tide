import { Pressable, View } from 'react-native';

import { Text } from '../../components/Text';
import { extensionsStore, useExtensions } from '../../extensions/state';
import { isActive } from '../../extensions/store';
import { colorThemes } from '../../extensions/themes/catalog';
import { useSettings } from '../../state';
import type { EditorTheme } from '../../theme/editor';
import { editorThemes } from '../../theme/editor';
import { makeStyles, useColors } from '../../theme/theme';
import { palette, radius, spacing } from '../../theme/tokens';

interface Option {
  id: string | null;
  name: string;
  editor: EditorTheme;
  brand: string;
}

// Settings > Appearance: Tide first, then the Themes & Icons themes, as
// swatch cards. Picking one sets the same pref as the command palette's picker.
export function ThemeGrid({ onMore }: { onMore?(): void }) {
  const styles = useStyles();
  const installed = useExtensions((s) => isActive(s, 'themes'));
  const chosen = useExtensions((s) => (isActive(s, 'themes') ? s.prefs.theme : null));
  // Tide's card previews the scheme the Theme setting asks for; with a color
  // theme in charge, the app's own scheme says nothing about Tide.
  const tideScheme = useSettings((s) => s.theme) === 'light' ? 'light' : 'dark';
  const options: Option[] = [
    { id: null, name: 'Tide', editor: editorThemes[tideScheme], brand: palette[tideScheme].brand },
    ...(installed ? colorThemes.map((t) => ({ id: t.id, name: t.name, editor: t.editor, brand: t.accent })) : []),
  ];

  return (
    <View>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {options.map((o) => (
          <Tile key={o.id ?? 'tide'} option={o} selected={o.id === chosen} onPress={() => extensionsStore.getState().setPref('theme', o.id)} />
        ))}
      </View>
      {!installed && (
        <Pressable
          testID="theme-install"
          accessibilityRole="button"
          onPress={() => {
            extensionsStore.getState().install('themes');
            onMore?.();
          }}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        >
          <Text variant="label">More themes</Text>
          <Text variant="muted" style={styles.moreDetail}>
            Install Themes & Icons (free)
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function Tile({ option, selected, onPress }: { option: Option; selected: boolean; onPress(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const e = option.editor;
  const bar = (color: string, width: `${number}%`) => <View style={[styles.bar, { backgroundColor: color, width }]} />;
  return (
    <Pressable
      testID={`theme-tile-${option.id ?? 'tide'}`}
      accessibilityRole="radio"
      accessibilityLabel={option.name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.cell}
    >
      {({ pressed }) => (
        <>
          <View style={[styles.preview, { backgroundColor: e.background, borderColor: selected ? colors.brand : e.gutterBorder }, selected && styles.previewOn, pressed && styles.pressed]}>
            <View style={styles.line}>
              {bar(e.syntax.keyword, '30%')}
              {bar(e.syntax.function, '40%')}
            </View>
            <View style={styles.line}>{bar(e.syntax.string, '60%')}</View>
            <View style={styles.line}>{bar(e.syntax.comment, '45%')}</View>
            <View style={[styles.brand, { backgroundColor: option.brand }]} />
          </View>
          <Text variant="label" numberOfLines={1} style={[styles.name, { color: selected ? colors.foreground : colors.mutedForeground }]}>
            {option.name}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  // Each cell is a third of the row and pads itself, since gap can't be a percentage.
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm },
  cell: { width: '33.333%', padding: spacing.xs },
  preview: { height: 64, borderRadius: radius.md, borderWidth: 1, padding: spacing.sm, gap: 5, overflow: 'hidden' },
  // Thicker as well as brand colored, so selection isn't shown by color alone.
  previewOn: { borderWidth: 2, padding: spacing.sm - 1 },
  line: { flexDirection: 'row', gap: 4 },
  bar: { height: 5, borderRadius: 3 },
  brand: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5 },
  name: { marginTop: spacing.xs, textAlign: 'center', fontSize: 12.5 },
  pressed: { opacity: 0.7 },
  more: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  moreDetail: { fontSize: 13, marginTop: 1 },
}));
