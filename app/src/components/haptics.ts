// Light touch feedback for the moments that benefit from it: key bar keys,
// trackpad steps, long presses, a run starting, things succeeding or failing.
// Off with Settings > Haptics.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { settingsStore } from '../state';

export type Haptic = 'tap' | 'select' | 'press' | 'success' | 'warning' | 'error';

const play: Record<Haptic, () => Promise<void>> = {
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  select: () => Haptics.selectionAsync(),
  press: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export function haptic(kind: Haptic): void {
  if (Platform.OS === 'web' || !settingsStore.getState().haptics) return;
  play[kind]().catch(() => undefined);
}
