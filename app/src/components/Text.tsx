import { Text as RNText, TextProps } from 'react-native';

import { fonts, fontSizes, letterSpacing } from '../theme/tokens';
import { makeStyles } from '../theme/theme';

type Variant = 'body' | 'label' | 'title' | 'heading' | 'muted' | 'mono' | 'error';

// Titles and headings are headers to screen readers, so they can jump between
// them, and stop growing at 1.6x so bars with buttons keep fitting. Other text
// follows the system text size without a limit.
const HEADERS = new Set<Variant>(['title', 'heading']);

export function Text({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  const styles = useStyles();
  const header = HEADERS.has(variant);
  return (
    <RNText
      accessibilityRole={header ? 'header' : undefined}
      maxFontSizeMultiplier={header ? 1.6 : undefined}
      {...props}
      style={[styles[variant], style]}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  body: { color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md },
  label: { color: colors.foreground, fontFamily: fonts.sans.medium, fontSize: fontSizes.sm },
  title: {
    color: colors.foreground,
    fontFamily: fonts.heading.semibold,
    fontSize: fontSizes.lg,
    letterSpacing: letterSpacing(fontSizes.lg),
  },
  heading: {
    color: colors.foreground,
    fontFamily: fonts.heading.medium,
    fontSize: fontSizes.xxl,
    letterSpacing: letterSpacing(fontSizes.xxl),
  },
  muted: { color: colors.mutedForeground, fontFamily: fonts.sans.regular, fontSize: fontSizes.sm },
  mono: { color: colors.foreground, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm },
  error: { color: colors.destructive, fontFamily: fonts.sans.regular, fontSize: fontSizes.sm },
}));
