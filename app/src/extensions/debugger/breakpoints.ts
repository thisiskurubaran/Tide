import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { storage } from '../../state';

const EMPTY: number[] = [];

export interface BreakpointsState {
  // project -> path -> 1-based lines
  byProject: Record<string, Record<string, number[]>>;
  // Where a debug session is paused, for the editor's highlight.
  paused: { project: string; path: string; line: number } | null;
  set(project: string, path: string, lines: number[]): void;
  clearAll(project: string): void;
  setPaused(paused: BreakpointsState['paused']): void;
}

export function createBreakpointsStore(s: StateStorage) {
  return createStore<BreakpointsState>()(
    persist(
      (set) => ({
        byProject: {},
        paused: null,
        set: (project, path, lines) =>
          set((st) => {
            const files = { ...st.byProject[project] };
            const sorted = [...new Set(lines)].sort((a, b) => a - b);
            if (sorted.length) files[path] = sorted;
            else delete files[path];
            return { byProject: { ...st.byProject, [project]: files } };
          }),
        clearAll: (project) => set((st) => ({ byProject: { ...st.byProject, [project]: {} } })),
        setPaused: (paused) => set({ paused }),
      }),
      { name: 'breakpoints', version: 1, storage: createJSONStorage(() => s), partialize: ({ byProject }) => ({ byProject }) },
    ),
  );
}

export const breakpointsStore = createBreakpointsStore(storage);
export const useBreakpoints = <T>(selector: (s: BreakpointsState) => T) => useStore(breakpointsStore, selector);
export const fileBreakpoints = (s: BreakpointsState, project: string, path: string) => s.byProject[project]?.[path] ?? EMPTY;
