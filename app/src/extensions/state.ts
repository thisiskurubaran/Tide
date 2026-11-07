import { useStore } from 'zustand';

import { storage } from '../state';
import { chromeThemeStore } from '../theme/chromeStore';
import { createExtensionsStore, ExtensionsState, isActive } from './store';
import type { ExtensionId } from './manifests';
import { colorThemeFor } from './themes/catalog';

export const extensionsStore = createExtensionsStore(storage);

// Hands the chosen color theme to the theme layer, which can't import this file.
const syncChrome = (s: ExtensionsState) => {
  const theme = isActive(s, 'themes') ? colorThemeFor(s.prefs.theme) : null;
  if (chromeThemeStore.getState().theme !== theme) chromeThemeStore.setState({ theme });
};
syncChrome(extensionsStore.getState());
extensionsStore.subscribe(syncChrome);

export const useExtensions = <T>(selector: (s: ExtensionsState) => T) => useStore(extensionsStore, selector);
export const useIsActive = (id: ExtensionId) => useExtensions((s) => isActive(s, id));
export const isExtensionActive = (id: ExtensionId) => isActive(extensionsStore.getState(), id);
export const usePrefs = () => useExtensions((s) => s.prefs);
