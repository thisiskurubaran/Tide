// Liquid Glass for the app's chrome (headers, the activity bar) on iOS 26+,
// with the solid colours everywhere else. The fallback rules live here so
// every bar makes the same choice.
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { StyleSheet, View, ViewProps } from 'react-native';

import { useColorScheme, useHighContrast } from '../theme/theme';
import { useReduceTransparency } from './a11y';

let available: boolean | undefined;

// The app is built against the iOS 26 SDK and runs on iOS 26+ (and the
// glass API is really there: some 26 betas lacked it). False on Android,
// web and older iOS.
export function liquidGlassAvailable(): boolean {
  if (available === undefined) {
    try {
      available = isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
    } catch {
      available = false;
    }
  }
  return available;
}

// Glass only when the system has it and the person hasn't asked for solid
// surfaces: Reduce Transparency, or high contrast (an accessibility need wins
// over the look).
export function useLiquidGlass(): boolean {
  const reduceTransparency = useReduceTransparency();
  const highContrast = useHighContrast();
  return liquidGlassAvailable() && !reduceTransparency && !highContrast;
}

// #rgb / #rrggbb / #rrggbbaa at the given opacity; anything else unchanged.
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${full}${a}`;
}

interface GlassSurfaceProps extends ViewProps {
  // The solid colour used without glass, and the glass tint (at partial
  // opacity) with it, so text in the theme's colours stays readable.
  color: string;
}

// A View whose background is Liquid Glass where available, else `color`.
// The glass sits behind the children and doesn't change the layout.
export function GlassSurface({ color, style, children, ...rest }: GlassSurfaceProps) {
  const glass = useLiquidGlass();
  const scheme = useColorScheme();
  return (
    <View {...rest} style={[style, { backgroundColor: glass ? 'transparent' : color }]}>
      {glass && (
        <GlassView
          pointerEvents="none"
          glassEffectStyle="regular"
          tintColor={withAlpha(color, 0.55)}
          colorScheme={scheme}
          style={StyleSheet.absoluteFill}
          testID="glass-background"
        />
      )}
      {children}
    </View>
  );
}
