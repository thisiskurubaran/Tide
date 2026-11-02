import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { ExtensionId, manifests } from './manifests';

// Settings that belong to one extension. Kept here rather than in the app
// settings so they go away with the extension's store entry.
export interface ExtensionPrefs {
  // Themes & Icons: a theme id from themes/catalog, or null for the default FuseOps theme.
  theme: string | null;
  fileIcons: boolean;
  // Format & Lint
  formatOnSave: boolean;
  lintAsYouType: boolean;
}

export const DEFAULT_PREFS: ExtensionPrefs = { theme: null, fileIcons: true, formatOnSave: false, lintAsYouType: true };

export interface ExtensionsState {
  // Extensions the user installed. They're free; installing only switches the
  // code that ships inside the app on.
  installed: ExtensionId[];
  prefs: ExtensionPrefs;
  install(id: ExtensionId): void;
  uninstall(id: ExtensionId): void;
  setPref<K extends keyof ExtensionPrefs>(key: K, value: ExtensionPrefs[K]): void;
}

export const isActive = (s: Pick<ExtensionsState, 'installed'>, id: ExtensionId) => s.installed.includes(id);

const order = (ids: ExtensionId[]) => manifests.map((m) => m.id).filter((id) => ids.includes(id));

export function createExtensionsStore(storage: StateStorage) {
  return createStore<ExtensionsState>()(
    persist(
      (set) => ({
        installed: [],
        prefs: DEFAULT_PREFS,
        install: (id) => set((s) => ({ installed: order([...s.installed, id]) })),
        uninstall: (id) => set((s) => ({ installed: s.installed.filter((i) => i !== id) })),
        setPref: (key, value) => set((s) => ({ prefs: { ...s.prefs, [key]: value } })),
      }),
      {
        name: 'extensions',
        version: 2,
        storage: createJSONStorage(() => storage),
        partialize: ({ installed, prefs }) => ({ installed, prefs }),
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<ExtensionsState>;
          const known = new Set(manifests.map((m) => m.id));
          return { ...current, installed: order((p.installed ?? []).filter((id) => known.has(id))), prefs: { ...DEFAULT_PREFS, ...p.prefs } };
        },
      },
    ),
  );
}
