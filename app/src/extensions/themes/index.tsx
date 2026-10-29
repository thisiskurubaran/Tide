import Feather from '@expo/vector-icons/Feather';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import type { IconName } from '../../components/Button';
import { EditorTheme, editorThemes } from '../../theme/editor';
import { TerminalTheme, terminalThemes } from '../../theme/terminal';
import { fonts } from '../../theme/tokens';
import type { ColorScheme } from '../../theme/tokens';
import { extensionsStore, useExtensions } from '../state';
import { isActive } from '../store';
import type { TideExtension } from '../types';
import { colorThemeFor, colorThemes } from './catalog';
import { fileIconFor } from './fileIcons';
import { ThemePicker } from './ThemePicker';

// The editor colors to use: the chosen theme while the pack is active,
// otherwise the FuseOps theme for the app's light or dark scheme.
export function useEditorTheme(scheme: ColorScheme): { colors: EditorTheme; dark: boolean } {
  const chosen = useExtensions((s) => (isActive(s, 'themes') ? s.prefs.theme : null));
  return useMemo(() => {
    const theme = colorThemeFor(chosen);
    return theme ? { colors: theme.editor, dark: theme.dark } : { colors: editorThemes[scheme], dark: scheme === 'dark' };
  }, [chosen, scheme]);
}

export function useTerminalTheme(scheme: ColorScheme): TerminalTheme {
  const chosen = useExtensions((s) => (isActive(s, 'themes') ? s.prefs.theme : null));
  return colorThemeFor(chosen)?.terminal ?? terminalThemes[scheme];
}

const ICON_SIZE = 16;

// The icon for a file in the tree and tabs, or `fallback` when the pack is off.
export function FileIcon({ name, fallback }: { name: string; fallback: React.ReactNode }) {
  const on = useExtensions((s) => isActive(s, 'themes') && s.prefs.fileIcons);
  const icon = on ? fileIconFor(name) : null;
  if (!icon) return <>{fallback}</>;
  if (icon.kind === 'icon') return <Feather name={icon.name as IconName} size={ICON_SIZE} color={icon.color} />;
  return (
    <View style={{ width: ICON_SIZE, alignItems: 'center' }}>
      <Text
        style={{ color: icon.color, fontFamily: fonts.mono.semibold, fontSize: icon.text.length > 2 ? 7 : 9, letterSpacing: -0.3 }}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {icon.text}
      </Text>
    </View>
  );
}

export const themesExtension: TideExtension = {
  id: 'themes',
  commands: (ctx) => [
    { id: 'themes.pick', title: 'Color theme', icon: 'droplet', run: () => ctx.openPanel('themes.picker') },
    {
      id: 'themes.next',
      title: 'Color theme: next',
      icon: 'chevrons-right',
      run: () => {
        const { prefs, setPref } = extensionsStore.getState();
        const ids = [null, ...colorThemes.map((t) => t.id)];
        setPref('theme', ids[(ids.indexOf(prefs.theme) + 1) % ids.length]);
      },
    },
  ],
  panels: [{ id: 'themes.picker', component: ThemePicker }],
};
