import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';

import { useReduceMotion } from './a11y';

const SEGMENTS = 48;
const SAMPLES = 9;
const AMPLITUDE = 2.2;
const HEIGHT = 8;

// Tide's signature: a line that rolls like a wave while something runs, then
// settles flat in green or red for a moment when it finishes. Built from
// short segments that each bob on a shifted sine, so it runs on the native
// driver without an SVG dependency.
export function TideWave({ state, color, done }: { state: 'running' | 'success' | 'error' | 'idle'; color: string; done: { success: string; error: string } }) {
  const reduceMotion = useReduceMotion();
  const phase = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== 'running' || reduceMotion) return;
    phase.setValue(0);
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [state, reduceMotion, phase]);

  useEffect(() => {
    Animated.timing(fade, { toValue: state === 'idle' ? 0 : 1, duration: reduceMotion ? 0 : 250, useNativeDriver: true }).start();
  }, [state, reduceMotion, fade]);

  const offsets = useMemo(
    () =>
      Array.from({ length: SEGMENTS }, (_, i) => {
        const inputRange = Array.from({ length: SAMPLES }, (_, k) => k / (SAMPLES - 1));
        const outputRange = inputRange.map((t) => AMPLITUDE * Math.sin(2 * Math.PI * (t * 2 - (i / SEGMENTS) * 3)));
        return phase.interpolate({ inputRange, outputRange });
      }),
    [phase],
  );

  const settled = state === 'success' || state === 'error';
  const tint = state === 'success' ? done.success : state === 'error' ? done.error : color;
  return (
    <Animated.View
      style={{ height: HEIGHT, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', opacity: fade }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="tide-wave"
    >
      {offsets.map((y, i) => (
        <Animated.View
          key={i}
          style={{
            flex: 1,
            height: 2,
            borderRadius: 1,
            backgroundColor: tint,
            // Brighter in the middle, fading toward the edges like the mockup.
            opacity: settled ? 1 : 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / SEGMENTS),
            transform: [{ translateY: settled || reduceMotion ? 0 : y }],
          }}
        />
      ))}
      <View />
    </Animated.View>
  );
}
