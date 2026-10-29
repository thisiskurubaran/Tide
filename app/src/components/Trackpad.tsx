import Feather from '@expo/vector-icons/Feather';
import { useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';

import { makeStyles, useColors } from '../theme/theme';
import { radius, spacing } from '../theme/tokens';
import { haptic } from './haptics';

export type Direction = 'left' | 'right' | 'up' | 'down';

// Points of drag per cursor step: across moves a character, down a line.
const STEP_X = 9;
const STEP_Y = 18;

// A key you drag to move the cursor, like holding the space bar on the iOS
// keyboard. It sits outside the key bar's scroll view so the drag isn't a scroll.
export function Trackpad({ onStep, testID }: { onStep(direction: Direction): void; testID?: string }) {
  const styles = useStyles();
  const colors = useColors();
  const used = useRef({ x: 0, y: 0 });
  const step = useRef(onStep);
  step.current = onStep;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          used.current = { x: 0, y: 0 };
        },
        onPanResponderMove: (_e, g) => {
          const sx = Math.trunc((g.dx - used.current.x) / STEP_X);
          const sy = Math.trunc((g.dy - used.current.y) / STEP_Y);
          // One tick per move, not per step: fast drags would buzz continuously.
          if (sx || sy) haptic('select');
          for (let i = 0; i < Math.abs(sx); i++) step.current(sx > 0 ? 'right' : 'left');
          for (let i = 0; i < Math.abs(sy); i++) step.current(sy > 0 ? 'down' : 'up');
          used.current = { x: used.current.x + sx * STEP_X, y: used.current.y + sy * STEP_Y };
        },
      }),
    [],
  );
  return (
    <View
      {...responder.panHandlers}
      testID={testID}
      style={styles.pad}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Cursor trackpad"
      accessibilityHint="Drag to move the cursor. Swipe up or down to move it by one character."
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step.current(e.nativeEvent.actionName === 'increment' ? 'right' : 'left')}
    >
      <Feather name="move" size={16} color={colors.foreground} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pad: {
    width: 56,
    height: 32,
    marginLeft: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
}));
