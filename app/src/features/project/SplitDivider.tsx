import { useMemo, useRef } from 'react';
import { PanResponder, View } from 'react-native';

import { makeStyles } from '../../theme/theme';
import { borderWidth } from '../../theme/tokens';
import { haptic } from '../../components/haptics';

export const MIN_RATIO = 0.25;
export const MAX_RATIO = 0.75;

// The bar between the two editors; drag it to resize them. `width` is the
// width of both panes together, which turns points dragged into a ratio.
interface SplitDividerProps {
  ratio: number;
  width: number;
  onChange(ratio: number): void;
  min?: number;
  max?: number;
  label?: string;
  testID?: string;
}

export function SplitDivider({ ratio, width, onChange, min = MIN_RATIO, max = MAX_RATIO, label = 'Editor split', testID = 'split-divider' }: SplitDividerProps) {
  const styles = useStyles();
  const start = useRef(ratio);
  const latest = useRef({ ratio, width, onChange, min, max });
  latest.current = { ratio, width, onChange, min, max };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = latest.current.ratio;
          haptic('select');
        },
        onPanResponderMove: (_e, g) => {
          const { width: w, onChange: change, min: lo, max: hi } = latest.current;
          if (w > 0) change(Math.min(hi, Math.max(lo, start.current + g.dx / w)));
        },
      }),
    [],
  );
  return (
    <View
      {...responder.panHandlers}
      testID={testID}
      style={styles.hit}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${Math.round(ratio * 100)} percent` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(Math.min(max, Math.max(min, ratio + (e.nativeEvent.actionName === 'increment' ? 0.05 : -0.05))))}
    >
      <View style={styles.line} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Wider than it looks, so it's easy to grab.
  hit: { width: 12, alignItems: 'center', justifyContent: 'center' },
  line: { width: borderWidth, alignSelf: 'stretch', backgroundColor: colors.border },
}));
