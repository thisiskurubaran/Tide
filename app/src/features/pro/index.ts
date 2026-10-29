import { router } from 'expo-router';
import { AppState } from 'react-native';
import { useStore } from 'zustand';

import { extensionsStore, purchases } from '../../extensions/state';
import { runnerStore, snapshots, storage } from '../../state';
import { FREE_LIMITS, PRO_LIMITS, ProFeature } from './plans';
import { createProStore, isPro, ProState } from './store';

export const proStore = createProStore(storage, purchases);
export const useProState = <T>(selector: (s: ProState) => T) => useStore(proStore, selector);
export const useIsPro = () => useProState((s) => isPro(s));
export const currentlyPro = () => isPro(proStore.getState());

// Everything outside the screens that depends on Pro: extensions are
// included, snapshots kept, and Remote mode falls back to Local when Pro
// ends so the terminal keeps working.
function syncExtensions() {
  const pro = currentlyPro();
  extensionsStore.setState({ included: pro });
  snapshots.setKeep(pro ? PRO_LIMITS.snapshots : FREE_LIMITS.snapshots);
  if (!pro && runnerStore.getState().mode === 'remote') runnerStore.getState().setMode('local');
}
proStore.subscribe(syncExtensions);

// Subscriptions renew and lapse while the app is closed: check on launch and
// whenever the app comes back to the foreground.
export function startPro(): void {
  syncExtensions();
  const check = () => proStore.getState().refresh().catch(() => undefined).finally(syncExtensions);
  check();
  AppState.addEventListener('change', (state) => state === 'active' && check());
}

// For a Pro feature: true when it can be used; otherwise opens the paywall,
// which names the feature, and returns false.
export function requirePro(feature: ProFeature): boolean {
  if (currentlyPro()) return true;
  router.push({ pathname: '/pro', params: { feature } });
  return false;
}
