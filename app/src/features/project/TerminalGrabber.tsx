import { useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';

import { haptic } from '../../components/haptics';
import { makeStyles } from '../../theme/theme';

// Heights the terminal settles at, as a share of the space it shares with the
// editor. Dragging below the lowest one hides it.
export const DETENTS = [0.3, 0.6, 0.92];
const HIDE_BELOW = 0.18;

export function snapFraction(fraction: number, velocity = 0): number | null {
  // A flick moves one detent in its direction.
  if (Math.abs(velocity) > 1) {
    const i = DETENTS.findIndex((d) => d >= fraction - 0.01);
    if (velocity < 0) return DETENTS[Math.min(DETENTS.length - 1, i < 0 ? DETENTS.length - 1 : i)];
    const below = [...DETENTS].reverse().find((d) => d < fraction - 0.01);
    return below ?? null;
  }
  if (fraction < HIDE_BELOW) return null;
  return DETENTS.reduce((best, d) => (Math.abs(d - fraction) < Math.abs(best - fraction) ? d : best), DETENTS[0]);
}

interface TerminalGrabberProps {
  fraction: number;
  // Height of the editor and terminal together.
  height: number;
  onChange(fraction: number): void;
  onHide(): void;
}

// The handle on top of the terminal sheet: drag it up or down, and it snaps
// to 30%, 60% or nearly full height; drag it away to hide the terminal.
export function TerminalGrabber({ fraction, height, onChange, onHide }: TerminalGrabberProps) {
  const styles = useStyles();
  const start = useRef(fraction);
  const latest = useRef({ fraction, height, onChange, onHide });
  latest.current = { fraction, height, onChange, onHide };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = latest.current.fraction;
        },
        onPanResponderMove: (_e, g) => {
          const { height: h, onChange: change } = latest.current;
          if (h > 0) change(Math.min(0.95, Math.max(0.08, start.current - g.dy / h)));
        },
        onPanResponderRelease: (_e, g) => {
          const { height: h, onChange: change, onHide: hide } = latest.current;
          const now = h > 0 ? start.current - g.dy / h : start.current;
          const next = snapFraction(now, g.vy);
          haptic('select');
          if (next === null) {
            change(start.current >= DETENTS[0] ? start.current : DETENTS[0]);
            hide();
          } else change(next);
        },
      }),
    [],
  );
  return (
    <View
      {...responder.panHandlers}
      style={styles.hit}
      testID="terminal-grabber"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Terminal height"
      accessibilityValue={{ text: `${Math.round(fraction * 100)} percent` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const i = DETENTS.indexOf(snapFraction(fraction) ?? DETENTS[0]);
        if (e.nativeEvent.actionName === 'increment') onChange(DETENTS[Math.min(DETENTS.length - 1, i + 1)]);
        else if (i === 0) onHide();
        else onChange(DETENTS[i - 1]);
      }}
    >
      <View style={styles.handle} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  hit: { height: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
}));
