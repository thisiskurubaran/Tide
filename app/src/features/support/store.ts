import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { storage } from '../../state';

export interface SupportState {
  installedAt: number;
  runs: number;
  askedVersion: string | null;
  // The version whose What's new was last shown; null until the first launch is done.
  seenVersion: string | null;
  // The first-run tour was finished or skipped.
  onboarded: boolean;
  countRun(): void;
  setOnboarded(done: boolean): void;
  asked(version: string): void;
  seen(version: string): void;
}

export function createSupportStore(s: StateStorage, now = Date.now) {
  return createStore<SupportState>()(
    persist(
      (set) => ({
        installedAt: now(),
        runs: 0,
        askedVersion: null,
        seenVersion: null,
        onboarded: false,
        setOnboarded: (onboarded) => set({ onboarded }),
        countRun: () => set((st) => ({ runs: st.runs + 1 })),
        asked: (askedVersion) => set({ askedVersion }),
        seen: (seenVersion) => set({ seenVersion }),
      }),
      {
        name: 'support',
        version: 1,
        storage: createJSONStorage(() => s),
        partialize: ({ installedAt, runs, askedVersion, seenVersion, onboarded }) => ({ installedAt, runs, askedVersion, seenVersion, onboarded }),
      },
    ),
  );
}

export const supportStore = createSupportStore(storage);
export const useSupport = <T>(selector: (s: SupportState) => T) => useStore(supportStore, selector);
