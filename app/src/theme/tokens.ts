// Tide's own identity: deep sea-green ink with a teal brand. Dark is the
// default; light keeps the same hues, deepened until text passes WCAG AA.
// When Settings > Appearance > Match the whole app is on and a Themes & Icons
// theme is chosen, chrome.ts derives these same keys from that theme instead.

export type ColorScheme = 'dark' | 'light';

export interface Colors {
  background: string;
  foreground: string;
  card: string;
  secondary: string;
  mutedForeground: string;
  border: string;
  brand: string;
  // Text and icons drawn on a brand fill (primary buttons, badges).
  brandForeground: string;
  brandSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  destructive: string;
  destructiveSoft: string;
  logoAccent: string;
}

export const palette: Record<ColorScheme, Colors> = {
  dark: {
    background: '#0a1115',
    foreground: '#eaf3f2',
    card: '#122027',
    secondary: '#17262e',
    mutedForeground: '#93aaa9',
    border: '#1d3039',
    brand: '#2dd4bf',
    // Teal is light, so dark ink reads on it.
    brandForeground: '#0a1115',
    brandSoft: '#0e2f2c',
    success: '#4ade80',
    successSoft: '#0f2a1c',
    warning: '#fbbf24',
    warningSoft: '#2b2210',
    destructive: '#fb7185',
    destructiveSoft: '#2e1419',
    logoAccent: '#0ea5e9',
  },
  light: {
    background: '#f7fbfa',
    foreground: '#0b1f24',
    card: '#ffffff',
    secondary: '#ebf3f2',
    mutedForeground: '#4f6866',
    border: '#d3e3e1',
    // #0d9488 (the logo teal) is only 3.4:1 on the background; teal-700 passes AA.
    brand: '#0f766e',
    brandForeground: '#ffffff',
    brandSoft: '#d5f3ef',
    success: '#15803d',
    successSoft: '#dcf5e4',
    warning: '#9a5b00',
    warningSoft: '#fbf0dc',
    destructive: '#be123c',
    destructiveSoft: '#fde4e8',
    logoAccent: '#0d9488',
  },
};

// For Increase Contrast (system or Settings > Appearance > Contrast): text
// reaches 7:1 (WCAG AAA) against the background, borders 3:1.
export const highContrast: Record<ColorScheme, Colors> = {
  dark: {
    ...palette.dark,
    background: '#000000',
    foreground: '#ffffff',
    card: '#0b1418',
    secondary: '#16262d',
    mutedForeground: '#c3d6d4',
    border: '#5f7a78',
    brand: '#5eead4',
    brandForeground: '#000000',
    success: '#86efac',
    warning: '#fcd34d',
    destructive: '#fda4af',
  },
  light: {
    ...palette.light,
    background: '#ffffff',
    foreground: '#000000',
    secondary: '#e6efee',
    mutedForeground: '#2f4341',
    border: '#7a8f8d',
    brand: '#0b4f4a',
    brandForeground: '#ffffff',
    success: '#14532d',
    warning: '#6b3a06',
    destructive: '#9f1239',
  },
};

export const colors = palette.dark;

// Hues the core palette doesn't name, for syntax and ANSI magenta/cyan, plus
// the dim grey of comments and line numbers. All pass AA on the card color,
// which the editor uses for the active line.
export const extended: Record<ColorScheme, { magenta: string; cyan: string; dim: string }> = {
  dark: { magenta: '#c4a7ff', cyan: '#38bdf8', dim: '#7a918e' },
  light: { magenta: '#7c3aed', cyan: '#0369a1', dim: '#5a6f6d' },
};

// PostScript names, which match the file names in assets/fonts, so the same
// string resolves on iOS (PostScript lookup) and Android (file name lookup).
export const fonts = {
  sans: { regular: 'Inter-Regular', medium: 'Inter-Medium', semibold: 'Inter-SemiBold' },
  heading: { medium: 'InstrumentSans-Medium', semibold: 'InstrumentSans-SemiBold' },
  mono: { regular: 'JetBrainsMono-Regular', semibold: 'JetBrainsMono-SemiBold' },
} as const;

// A compact scale, closer to desktop IDE chrome; Dynamic Type still scales it.
export const fontSizes = { xs: 11, sm: 13, md: 15, lg: 16, xl: 19, xxl: 26 } as const;

export const lineHeights = { body: 1.6, heading: 1.12, code: 1.5 } as const;

// Headings and the wordmark use -0.02em; RN wants absolute points.
export const letterSpacing = (fontSize: number) => fontSize * -0.02;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 10, lg: 12, xl: 16, pill: 999 } as const;

export const borderWidth = 1;
