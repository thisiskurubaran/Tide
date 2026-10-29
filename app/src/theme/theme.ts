import { StyleSheet, useColorScheme as useSystemScheme } from 'react-native';

import { useSystemA11y } from '../components/a11y';
import { useSettings } from '../state';
import { ColorScheme, Colors, highContrast, palette } from './tokens';

export function useColorScheme(): ColorScheme {
  const setting = useSettings((s) => s.theme);
  const system = useSystemScheme();
  if (setting !== 'system') return setting;
  return system === 'light' ? 'light' : 'dark';
}

// Settings > Appearance > Contrast, where "system" follows Increase Contrast.
export function useHighContrast(): boolean {
  const setting = useSettings((s) => s.contrast);
  const { increaseContrast } = useSystemA11y();
  return setting === 'high' || (setting === 'system' && increaseContrast);
}

const colorsFor = (scheme: ColorScheme, high: boolean) => (high ? highContrast : palette)[scheme];

export const useColors = (): Colors => colorsFor(useColorScheme(), useHighContrast());

// Styles are built once per scheme and reused, like a module-level StyleSheet.
type Styles = Parameters<typeof StyleSheet.create>[0];

export function makeStyles<T extends Styles>(build: (colors: Colors) => T) {
  const cache: Partial<Record<string, Readonly<T>>> = {};
  return function useStyles(): Readonly<T> {
    const scheme = useColorScheme();
    const high = useHighContrast();
    return (cache[`${scheme}:${high}`] ??= StyleSheet.create(build(colorsFor(scheme, high))));
  };
}
