import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { gitSettingsStore } from '../features/git/settings';
import { remoteSettingsStore } from '../features/remote/settings';
import { projectsStore, runnerStore, settingsStore, tabsStore } from '../state';
import { useColorScheme, useColors } from '../theme/theme';

SplashScreen.preventAutoHideAsync();

type Persisted = { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } };

const hydrated = (store: Persisted) =>
  new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) resolve();
    else store.persist.onFinishHydration(() => resolve());
  });

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const scheme = useColorScheme();
  const colors = useColors();

  useEffect(() => {
    // Keep the splash up until saved tabs and the project list are loaded,
    // so a restart lands on the right screen without flashing an empty one.
    Promise.all([
      hydrated(tabsStore),
      hydrated(runnerStore),
      hydrated(settingsStore),
      projectsStore.getState().refresh(),
      remoteSettingsStore.getState().load().catch(() => undefined),
      gitSettingsStore.getState().load().catch(() => undefined),
    ]).finally(() => {
      setReady(true);
      SplashScreen.hideAsync();
    });
  }, []);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}
