import { useStore } from 'zustand';

import { storage } from '../state';
import { createExtensionsStore, ExtensionsState, isActive } from './store';
import type { ExtensionId } from './manifests';

export const extensionsStore = createExtensionsStore(storage);

export const useExtensions = <T>(selector: (s: ExtensionsState) => T) => useStore(extensionsStore, selector);
export const useIsActive = (id: ExtensionId) => useExtensions((s) => isActive(s, id));
export const isExtensionActive = (id: ExtensionId) => isActive(extensionsStore.getState(), id);
export const usePrefs = () => useExtensions((s) => s.prefs);
