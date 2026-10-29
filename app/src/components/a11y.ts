// System accessibility settings the app follows, and announcements for
// screen readers.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

interface SystemA11y {
  reduceMotion: boolean;
  // iOS Increase Contrast, Android high contrast text.
  increaseContrast: boolean;
}

let state: SystemA11y = { reduceMotion: false, increaseContrast: false };
const listeners = new Set<() => void>();
let started = false;

function set(patch: Partial<SystemA11y>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function start() {
  if (started) return;
  started = true;
  AccessibilityInfo.isReduceMotionEnabled?.().then((reduceMotion) => set({ reduceMotion }), () => undefined);
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (reduceMotion) => set({ reduceMotion }));
  if (Platform.OS === 'ios') {
    AccessibilityInfo.isDarkerSystemColorsEnabled?.().then((increaseContrast) => set({ increaseContrast }), () => undefined);
    AccessibilityInfo.addEventListener?.('darkerSystemColorsChanged', (increaseContrast) => set({ increaseContrast }));
  } else if (Platform.OS === 'android') {
    AccessibilityInfo.isHighTextContrastEnabled?.().then((increaseContrast) => set({ increaseContrast }), () => undefined);
    AccessibilityInfo.addEventListener?.('highTextContrastChanged', (increaseContrast) => set({ increaseContrast }));
  }
}

const subscribe = (l: () => void) => {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useSystemA11y = () => useSyncExternalStore(subscribe, () => state);
export const useReduceMotion = () => useSystemA11y().reduceMotion;

// Slide for most people, none with Reduce Motion on.
export const useModalAnimation = (normal: 'slide' | 'fade' = 'slide') => (useReduceMotion() ? 'none' : normal);

// Tells VoiceOver / TalkBack something that happened off-screen or without
// focus moving, like a run or a test run finishing.
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility?.(message);
}
