import { ColorScheme, extended, palette } from './tokens';

// Same keys as xterm.js ITheme, kept local until the terminal bundle lands in Phase 3.
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const dark = palette.dark;
const light = palette.light;

export const terminalThemes: Record<ColorScheme, TerminalTheme> = {
  dark: {
    background: dark.background,
    foreground: dark.foreground,
    cursor: dark.foreground,
    cursorAccent: dark.background,
    selectionBackground: dark.brandSoft,
    black: dark.border,
    red: dark.destructive,
    green: dark.success,
    yellow: dark.warning,
    // extended.cyan is a sky blue, so it plays ANSI blue and the brand teal plays cyan.
    blue: extended.dark.cyan,
    magenta: extended.dark.magenta,
    cyan: dark.brand,
    white: dark.mutedForeground,
    brightBlack: extended.dark.dim,
    // Pale tints of the base hues.
    brightRed: '#fecdd3',
    brightGreen: '#bbf7d0',
    brightYellow: '#fde68a',
    brightBlue: '#bae6fd',
    brightMagenta: '#e4d8ff',
    brightCyan: '#99f6e4',
    brightWhite: dark.foreground,
  },
  // On a light background "white" text would vanish, so white and brightWhite
  // are dark greys and the bright colors are deeper shades instead of tints.
  light: {
    background: light.background,
    foreground: light.foreground,
    cursor: light.foreground,
    cursorAccent: light.background,
    selectionBackground: light.brandSoft,
    black: light.foreground,
    red: light.destructive,
    green: light.success,
    yellow: light.warning,
    blue: extended.light.cyan,
    magenta: extended.light.magenta,
    cyan: light.brand,
    white: light.mutedForeground,
    brightBlack: extended.light.dim,
    brightRed: '#9f1239',
    brightGreen: '#14532d',
    brightYellow: '#713f12',
    brightBlue: '#075985',
    brightMagenta: '#5b21b6',
    brightCyan: '#134e4a',
    brightWhite: '#2c3f43',
  },
};
