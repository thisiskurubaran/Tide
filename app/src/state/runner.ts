import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

// Where commands run: the built-in shell on the device, or a container on the Tide server.
export type RunnerMode = 'local' | 'remote';

export interface RunnerState {
  mode: RunnerMode;
  setMode(mode: RunnerMode): void;
}

export function createRunnerStore(storage: StateStorage) {
  return createStore<RunnerState>()(
    persist(
      (set) => ({
        mode: 'local',
        setMode: (mode) => set({ mode }),
      }),
      { name: 'runner', version: 1, storage: createJSONStorage(() => storage), partialize: (s) => ({ mode: s.mode }) },
    ),
  );
}
