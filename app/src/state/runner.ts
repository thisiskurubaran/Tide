import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

// Where commands run: the built-in shell on the device, or a container on the Tide server.
export type RunnerMode = 'local' | 'remote';

export interface RunnerState {
  mode: RunnerMode;
  // Per project, the tide.json configuration ⌘R runs; missing means the default.
  configs: Record<string, string>;
  setMode(mode: RunnerMode): void;
  setConfig(project: string, name: string): void;
}

export function createRunnerStore(storage: StateStorage) {
  return createStore<RunnerState>()(
    persist(
      (set) => ({
        mode: 'local',
        configs: {},
        setMode: (mode) => set({ mode }),
        setConfig: (project, name) => set((s) => ({ configs: { ...s.configs, [project]: name } })),
      }),
      { name: 'runner', version: 1, storage: createJSONStorage(() => storage), partialize: (s) => ({ mode: s.mode, configs: s.configs }) },
    ),
  );
}
