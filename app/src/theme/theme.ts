import { StyleSheet, useColorScheme as useSystemScheme } from 'react-native';

import { useSettings } from '../state';
import { ColorScheme, Colors, palette } from './tokens';

export function useColorScheme(): ColorScheme {
  const setting = useSettings((s) => s.theme);
  const system = useSystemScheme();
  if (setting !== 'system') return setting;
  return system === 'light' ? 'light' : 'dark';
}

export const useColors = (): Colors => palette[useColorScheme()];

// Styles are built once per scheme and reused, like a module-level StyleSheet.
type Styles = Parameters<typeof StyleSheet.create>[0];

export function makeStyles<T extends Styles>(build: (colors: Colors) => T) {
  const cache: Partial<Record<ColorScheme, Readonly<T>>> = {};
  return function useStyles(): Readonly<T> {
    const scheme = useColorScheme();
    return (cache[scheme] ??= StyleSheet.create(build(palette[scheme])));
  };
}
