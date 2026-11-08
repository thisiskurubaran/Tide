// The last dev server, test run or task to finish, for the Last run and Lock
// Screen widgets. Kept in app state (.tide) so the widgets still have it after
// a relaunch rebuilds their data.
import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { LastRun } from './sync';

export interface LastRunState {
  lastRun: LastRun | null;
  record(run: LastRun): void;
  renameProject(from: string, to: string): void;
  forget(project: string): void;
}

export function createLastRunStore(storage: StateStorage) {
  return createStore<LastRunState>()(
    persist(
      (set) => ({
        lastRun: null,
        record: (run) => set({ lastRun: run }),
        renameProject: (from, to) => set((s) => (s.lastRun?.project === from ? { lastRun: { ...s.lastRun, project: to } } : s)),
        forget: (project) => set((s) => (s.lastRun?.project === project ? { lastRun: null } : s)),
      }),
      {
        name: 'widget-last-run',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (s) => ({ lastRun: s.lastRun }),
      },
    ),
  );
}
