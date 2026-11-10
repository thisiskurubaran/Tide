// System accessibility settings the app follows, and announcements for
// screen readers.
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

interface SystemA11y {
  reduceMotion: boolean;
  // iOS Increase Contrast, Android high contrast text.
  increaseContrast: boolean;
  // VoiceOver / TalkBack is running.
  screenReader: boolean;
  // iOS Reduce Transparency: glass and blur give way to solid colours.
  reduceTransparency: boolean;
}

let state: SystemA11y = { reduceMotion: false, increaseContrast: false, screenReader: false, reduceTransparency: false };
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
  // react-native-web always reports a screen reader, which would turn
  // gestures off in the browser build; only trust it on iOS and Android.
  if (Platform.OS !== 'web') {
    AccessibilityInfo.isScreenReaderEnabled?.().then((screenReader) => set({ screenReader }), () => undefined);
    AccessibilityInfo.addEventListener?.('screenReaderChanged', (screenReader) => set({ screenReader }));
  }
  if (Platform.OS === 'ios') {
    AccessibilityInfo.isDarkerSystemColorsEnabled?.().then((increaseContrast) => set({ increaseContrast }), () => undefined);
    AccessibilityInfo.addEventListener?.('darkerSystemColorsChanged', (increaseContrast) => set({ increaseContrast }));
    AccessibilityInfo.isReduceTransparencyEnabled?.().then((reduceTransparency) => set({ reduceTransparency }), () => undefined);
    AccessibilityInfo.addEventListener?.('reduceTransparencyChanged', (reduceTransparency) => set({ reduceTransparency }));
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
export const useScreenReader = () => useSystemA11y().screenReader;
export const useReduceTransparency = () => useSystemA11y().reduceTransparency;

// Slide for most people, none with Reduce Motion on.
export const useModalAnimation = (normal: 'slide' | 'fade' = 'slide') => (useReduceMotion() ? 'none' : normal);

// Tells VoiceOver / TalkBack something that happened off-screen or without
// focus moving, like a run or a test run finishing.
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility?.(message);
}
