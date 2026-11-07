import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';

import { useScreenReader } from '../../components/a11y';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { settingsStore, useSettings } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { ALL_GESTURES, type EditorGestures } from '../editor/bridge';

type Motion = 'swipe' | 'pinch' | 'pull' | 'tap';

const GESTURES: { key: keyof EditorGestures; title: string; description: string; fingers: number; motion: Motion }[] = [
  { key: 'tabs', title: 'Switch tabs', description: 'Swipe left or right with two fingers for the next or previous tab.', fingers: 2, motion: 'swipe' },
  { key: 'pinch', title: 'Zoom the code', description: 'Pinch to make the code bigger or smaller. The size is saved.', fingers: 2, motion: 'pinch' },
  { key: 'undo', title: 'Undo and redo', description: 'Swipe left with three fingers to undo, right to redo.', fingers: 3, motion: 'swipe' },
  { key: 'pullPalette', title: 'Pull for commands', description: 'At the top of a file, pull down and let go to open the command palette.', fingers: 1, motion: 'pull' },
  { key: 'twoFingerTap', title: 'Editor actions', description: 'Tap with two fingers for actions on the code.', fingers: 2, motion: 'tap' },
];

// Touch gestures in the editor, each with a switch.
export function GesturesScreen() {
  const styles = useStyles();
  const colors = useColors();
  const saved = useSettings((s) => s.gestures);
  const gestures = { ...ALL_GESTURES, ...saved };
  const screenReader = useScreenReader();
  return (
    <Screen title="Gestures" subtitle="Touch shortcuts in the editor" testID="gestures">
      <View style={styles.card}>
        {GESTURES.map((g) => (
          <View key={g.key} style={styles.row}>
            <GestureIcon fingers={g.fingers} motion={g.motion} />
            <View style={styles.text}>
              <Text variant="label">{g.title}</Text>
              <Text variant="muted" style={styles.description}>
                {g.description}
              </Text>
            </View>
            <Switch
              testID={`gesture-${g.key}`}
              accessibilityLabel={g.title}
              value={gestures[g.key]}
              onValueChange={(on) => settingsStore.getState().setGesture(g.key, on)}
              trackColor={{ true: colors.brand, false: colors.secondary }}
            />
          </View>
        ))}
      </View>
      <Text variant="muted" style={styles.note}>
        Gestures never type into your code. They turn off while VoiceOver is running.
        {screenReader ? ' A screen reader is running now, so they are off.' : ''}
      </Text>
    </Screen>
  );
}

const ICON = 44;
const DOT = 10;

// A small drawing of the gesture: teal dots for fingers, a line for the motion.
function GestureIcon({ fingers, motion }: { fingers: number; motion: Motion }) {
  const styles = useStyles();
  const dot = (left: number, top: number, key: number) => <View key={key} style={[styles.dot, { left: left - DOT / 2, top: top - DOT / 2 }]} />;
  const mid = ICON / 2;
  let line: ReactNode = null;
  let dots: ReactNode[] = [];
  switch (motion) {
    case 'swipe': {
      const gap = 12;
      const top = mid - ((fingers - 1) * gap) / 2;
      dots = Array.from({ length: fingers }, (_, i) => dot(mid, top + i * gap, i));
      line = <View style={[styles.line, { left: 4, right: 4, top: mid - 1, height: 2 }]} />;
      break;
    }
    case 'pinch':
      dots = [dot(12, ICON - 12, 0), dot(ICON - 12, 12, 1)];
      line = <View style={[styles.line, { left: 6, right: 6, top: mid - 1, height: 2, transform: [{ rotate: '-45deg' }] }]} />;
      break;
    case 'pull':
      dots = [dot(mid, 10, 0)];
      line = <View style={[styles.line, { top: 10, bottom: 4, left: mid - 1, width: 2 }]} />;
      break;
    case 'tap':
      dots = [dot(mid - 8, mid, 0), dot(mid + 8, mid, 1)];
      line = <View style={[styles.ring, { left: mid - 18, top: mid - 10, width: 36, height: 20 }]} />;
      break;
  }
  return (
    <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {line}
      {dots}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth, borderColor: colors.border, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
    marginBottom: -borderWidth,
  },
  icon: { width: ICON, height: ICON, borderRadius: radius.md, backgroundColor: colors.secondary },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.brand },
  line: { position: 'absolute', backgroundColor: colors.brand, opacity: 0.45, borderRadius: 1 },
  ring: { position: 'absolute', borderWidth: 1.5, borderColor: colors.brand, opacity: 0.45, borderRadius: 10 },
  text: { flex: 1, gap: 2 },
  description: { fontSize: fontSizes.sm },
  note: { paddingHorizontal: spacing.xs, paddingTop: spacing.md, fontSize: fontSizes.sm },
}));
