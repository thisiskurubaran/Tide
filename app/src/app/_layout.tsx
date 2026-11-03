import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';

import { breakpointsStore } from '../extensions/debugger/breakpoints';
import { extensionsStore } from '../extensions/state';
import { startTips } from '../features/tips';
// Keeps a local history of every file save.
import '../features/history';
import { gitSettingsStore } from '../features/git/settings';
import { accountsStore } from '../features/hosts/accounts';
import { startWidgets } from '../features/widgets';
import { linkedStore } from '../features/external';
import { keyBarStore } from '../features/keybar/store';
import { startQuickActions } from '../features/launch/quickActions';
import { startCrashReports } from '../features/privacy/crashReports';
import { remoteSettingsStore } from '../features/remote/settings';
import { projectsStore, runnerStore, settingsStore, tabsStore, useSettings } from '../state';
import { useChromeTheme, useColors } from '../theme/theme';
import { captureConsole } from '../features/support/logs';
import { supportStore } from '../features/support/store';
import { WasmHost } from '../runtime/wasm';
import { RuffHost } from '../extensions/formatLint/RuffHost';

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
  // A color theme the app follows sets light or dark itself (Solarized Light
  // makes the whole app light).
  const chrome = useChromeTheme();
  const windowScheme = chrome ? (chrome.dark ? 'dark' : 'light') : theme === 'system' ? 'auto' : theme;

  // The window takes the app's theme, so the status bar, keyboard and system
  // dialogs match it. Setting the status bar style from JS instead was lost
  // whenever the device switched between light and dark.
  useEffect(() => {
    Appearance.setColorScheme(windowScheme);
  }, [windowScheme]);

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
      accountsStore.getState().load().catch(() => undefined),
    ]).finally(() => {
      startCrashReports(settingsStore);
      startQuickActions();
      startWidgets();
      startTips();
      setReady(true);
      SplashScreen.hideAsync();
    });
  }, []);

  if (!ready) return null;

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      <WasmHost />
      <RuffHost />
    </>
  );
}
