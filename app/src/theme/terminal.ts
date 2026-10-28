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
    blue: dark.brand,
    magenta: extended.dark.magenta,
    cyan: extended.dark.cyan,
    white: dark.mutedForeground,
    brightBlack: extended.dark.dim,
    // Red, green, yellow and blue tints are from fuseops.in; magenta and cyan follow them.
    brightRed: '#f3c7c2',
    brightGreen: '#bfe6d6',
    brightYellow: '#f6dcae',
    brightBlue: '#c9d6ff',
    brightMagenta: '#ddc9ff',
    brightCyan: '#a6e6ee',
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
    blue: light.brand,
    magenta: extended.light.magenta,
    cyan: extended.light.cyan,
    white: light.mutedForeground,
    brightBlack: extended.light.dim,
    brightRed: '#9e2c23',
    brightGreen: '#1a5c45',
    brightYellow: '#7a4800',
    brightBlue: '#2b3350',
    brightMagenta: '#5b21b6',
    brightCyan: '#155e75',
    brightWhite: '#3a413e',
  },
};
