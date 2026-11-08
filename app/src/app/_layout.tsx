import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Appearance } from 'react-native';

import { breakpointsStore } from '../extensions/debugger/breakpoints';
import { extensionsStore } from '../extensions/state';
// Keeps a local history of every file save.
import '../features/history';
import { changesStore } from '../features/agent/changesStore';
import { gitSettingsStore } from '../features/git/settings';
import { accountsStore } from '../features/hosts/accounts';
import { startWidgets } from '../features/widgets';
import { linkedStore } from '../features/external';
import { keyBarStore } from '../features/keybar/store';
import { startQuickActions } from '../features/launch/quickActions';
import { startCrashReports } from '../features/privacy/crashReports';
import { remoteSettingsStore } from '../features/remote/settings';
import { projectsStore, recentsStore, runnerStore, settingsStore, tabsStore, useSettings } from '../state';
import { allLoaded, hydrated } from '../state/hydrated';
import { useChromeTheme, useColors } from '../theme/theme';
import { captureConsole } from '../features/support/logs';
import { supportStore } from '../features/support/store';
import { WasmHost } from '../runtime/wasm';
import { RuffHost } from '../extensions/formatLint/RuffHost';

// Before anything else logs, so bug reports include start-up warnings.
captureConsole();
SplashScreen.preventAutoHideAsync();

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
    // allLoaded waits for each on its own and reports its own failure, so one
    // that fails (the project list can't be read) doesn't lift the splash
    // before the rest have loaded.
    allLoaded([
      hydrated(tabsStore),
      // Recent projects and files: loaded before any screen touches them, or
      // the saved list would replace those early updates once it loads.
      hydrated(recentsStore),
      hydrated(runnerStore),
      hydrated(settingsStore),
      hydrated(extensionsStore),
      hydrated(breakpointsStore),
      hydrated(keyBarStore),
      hydrated(linkedStore),
      hydrated(supportStore),
      // The agent's unreviewed changes, so Review and Undo work after a relaunch.
      hydrated(changesStore),
      projectsStore.getState().refresh(),
      remoteSettingsStore.getState().load(),
      gitSettingsStore.getState().load(),
      accountsStore.getState().load(),
    ]).finally(() => {
      startCrashReports(settingsStore);
      startQuickActions();
      startWidgets();
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
