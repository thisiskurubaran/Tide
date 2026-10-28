import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { remoteSettingsStore } from '../features/remote/settings';
import { projectsStore, runnerStore, tabsStore } from '../state';
import { colors } from '../theme/tokens';

SplashScreen.preventAutoHideAsync();

type Persisted = { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } };

const hydrated = (store: Persisted) =>
  new Promise<void>((resolve) => {
    if (store.persist.hasHydrated()) resolve();
    else store.persist.onFinishHydration(() => resolve());
  });

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Keep the splash up until saved tabs and the project list are loaded,
    // so a restart lands on the right screen without flashing an empty one.
    Promise.all([
      hydrated(tabsStore),
      hydrated(runnerStore),
      projectsStore.getState().refresh(),
      remoteSettingsStore.getState().load().catch(() => undefined),
    ]).finally(() => {
      setReady(true);
      SplashScreen.hideAsync();
    });
  }, []);

  if (!ready) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}
