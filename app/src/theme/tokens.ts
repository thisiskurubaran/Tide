// FuseOps theme (https://fuseops.in), see docs/brand.md for where each value comes from.
// Dark is Tide's default; light uses the FuseOps light palette as is.

export type ColorScheme = 'dark' | 'light';

export interface Colors {
  background: string;
  foreground: string;
  card: string;
  secondary: string;
  mutedForeground: string;
  border: string;
  brand: string;
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
    background: '#0d0f0e',
    foreground: '#f1f3f2',
    card: '#151817',
    secondary: '#1c201e',
    mutedForeground: '#a3aaa7',
    border: '#272c2a',
    brand: '#7c9bff',
    brandSoft: '#1a2240',
    success: '#3fc095',
    successSoft: '#12271f',
    warning: '#e8b04f',
    warningSoft: '#2a2213',
    destructive: '#f2776d',
    destructiveSoft: '#2c1715',
    logoAccent: '#1d4ed8',
  },
  light: {
    background: '#fcfcfb',
    foreground: '#111413',
    card: '#ffffff',
    secondary: '#f3f3f1',
    mutedForeground: '#646b69',
    border: '#e7e7e4',
    brand: '#1d4ed8',
    brandSoft: '#e8eefc',
    success: '#0f6e4e',
    successSoft: '#e3f2ec',
    warning: '#9a5b00',
    warningSoft: '#fbf0dc',
    destructive: '#c4372c',
    destructiveSoft: '#fbe7e5',
    logoAccent: '#7c9bff',
  },
};

// For Increase Contrast (system or Settings > Appearance > Contrast): text
// reaches 7:1 (WCAG AAA) against the background, borders 3:1.
export const highContrast: Record<ColorScheme, Colors> = {
  dark: {
    ...palette.dark,
    background: '#000000',
    card: '#0e1110',
    secondary: '#1f2422',
    mutedForeground: '#d0d6d3',
    border: '#6b7471',
    brand: '#a9bdff',
    success: '#62e3b5',
    warning: '#ffcd70',
    destructive: '#ff9d95',
  },
  light: {
    ...palette.light,
    background: '#ffffff',
    foreground: '#000000',
    secondary: '#ececea',
    mutedForeground: '#363c3a',
    border: '#858b89',
    brand: '#1638a8',
    success: '#08573d',
    warning: '#6e4100',
    destructive: '#9c241b',
  },
};

export const colors = palette.dark;

// Hues FuseOps doesn't define, needed for syntax and ANSI magenta/cyan.
// Picked to sit between the brand blue and success green and pass WCAG AA.
export const extended: Record<ColorScheme, { magenta: string; cyan: string; dim: string }> = {
  dark: { magenta: '#c49bff', cyan: '#4fc6d6', dim: '#7d8582' },
  light: { magenta: '#7c3aed', cyan: '#0e7490', dim: '#5b6361' },
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

// FuseOps headings and the wordmark use -0.02em; RN wants absolute points.
export const letterSpacing = (fontSize: number) => fontSize * -0.02;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 10, lg: 12, xl: 16, pill: 999 } as const;

export const borderWidth = 1;
