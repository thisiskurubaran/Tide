import { StyleSheet, Text as RNText, TextProps } from 'react-native';

import { colors, fonts, fontSizes, letterSpacing } from '../theme/tokens';

type Variant = 'body' | 'label' | 'title' | 'heading' | 'muted' | 'mono' | 'error';

export function Text({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <RNText {...props} style={[styles[variant], style]} />;
}

const styles = StyleSheet.create({
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
});
