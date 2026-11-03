import { StyleSheet, useColorScheme as useSystemScheme } from 'react-native';

import type { ColorTheme } from '../extensions/themes/catalog';
import { useSystemA11y } from '../components/a11y';
import { useSettings } from '../state';
import { chromeColorsCached } from './chrome';
import { useChosenColorTheme } from './chromeStore';
import { ColorScheme, Colors, highContrast, palette } from './tokens';

// The color theme the whole app follows, or null for Tide's own palette.
// Settings that predate matchChrome read undefined, which means on.
export function useChromeTheme(): ColorTheme | null {
  const match = useSettings((s) => s.matchChrome) !== false;
  const chosen = useChosenColorTheme();
  return match ? chosen : null;
}

export function useColorScheme(): ColorScheme {
  const setting = useSettings((s) => s.theme);
  const system = useSystemScheme();
  const chrome = useChromeTheme();
  // A light color theme makes the whole app light, whatever the Theme setting says.
  if (chrome) return chrome.dark ? 'dark' : 'light';
  if (setting !== 'system') return setting;
  return system === 'light' ? 'light' : 'dark';
}

// Settings > Appearance > Contrast, where "system" follows Increase Contrast.
export function useHighContrast(): boolean {
  const setting = useSettings((s) => s.contrast);
  const { increaseContrast } = useSystemA11y();
  return setting === 'high' || (setting === 'system' && increaseContrast);
}

// High contrast wins over theme chrome: it's an accessibility need, not a look.
const colorsFor = (scheme: ColorScheme, high: boolean, chrome: ColorTheme | null): Colors =>
  high ? highContrast[scheme] : chrome ? chromeColorsCached(chrome) : palette[scheme];

export function useColors(): Colors {
  const scheme = useColorScheme();
  const high = useHighContrast();
  return colorsFor(scheme, high, useChromeTheme());
}

// Styles are built once per scheme and theme and reused, like a module-level StyleSheet.
type Styles = Parameters<typeof StyleSheet.create>[0];

export function makeStyles<T extends Styles>(build: (colors: Colors) => T) {
  const cache: Partial<Record<string, Readonly<T>>> = {};
  return function useStyles(): Readonly<T> {
    const scheme = useColorScheme();
    const high = useHighContrast();
    const chrome = useChromeTheme();
    // chrome is null when matchChrome is off, so its id covers both.
    const key = `${scheme}:${high}:${chrome?.id ?? 'tide'}`;
    return (cache[key] ??= StyleSheet.create(build(colorsFor(scheme, high, chrome))));
  };
}
