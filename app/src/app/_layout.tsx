import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';

import { breakpointsStore } from '../extensions/debugger/breakpoints';
import { extensionsStore } from '../extensions/state';
import { gitSettingsStore } from '../features/git/settings';
import { linkedStore } from '../features/external';
import { keyBarStore } from '../features/keybar/store';
import { startQuickActions } from '../features/launch/quickActions';
import { startCrashReports } from '../features/privacy/crashReports';
import { remoteSettingsStore } from '../features/remote/settings';
import { projectsStore, runnerStore, settingsStore, tabsStore, useSettings } from '../state';
import { useColors } from '../theme/theme';
import { captureConsole } from '../features/support/logs';
import { supportStore } from '../features/support/store';

// Before anything else logs, so bug reports include start-up warnings.
captureConsole();
SplashScreen.preventAutoHideAsync();

type Persisted = { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } };

const hydrated = (store: Persisted) =>
  new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) resolve();
    else store.persist.onFinishHydration(() => resolve());
  });

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const theme = useSettings((s) => s.theme);
  const colors = useColors();

  // The window takes the app's theme, so the status bar, keyboard and system
  // dialogs match it. Setting the status bar style from JS instead was lost
  // whenever the device switched between light and dark.
  useEffect(() => {
    Appearance.setColorScheme(theme === 'system' ? 'auto' : theme);
  }, [theme]);

  useEffect(() => {
    // Keep the splash up until saved tabs and the project list are loaded,
    // so a restart lands on the right screen without flashing an empty one.
    Promise.all([
      hydrated(tabsStore),
      hydrated(runnerStore),
      hydrated(settingsStore),
      hydrated(extensionsStore),
      hydrated(breakpointsStore),
      hydrated(keyBarStore),
      hydrated(linkedStore),
      hydrated(supportStore),
      projectsStore.getState().refresh(),
      remoteSettingsStore.getState().load().catch(() => undefined),
      gitSettingsStore.getState().load().catch(() => undefined),
    ]).finally(() => {
      startCrashReports(settingsStore);
      startQuickActions();
      setReady(true);
      SplashScreen.hideAsync();
      // Prices and purchases made on another device; the cached list works until it answers.
      extensionsStore.getState().refresh().catch(() => undefined);
    });
  }, []);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
  );
}
