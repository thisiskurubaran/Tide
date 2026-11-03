import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { createExpoFs } from '../features/files/expoFs';
import { createFsStorage } from './storage';

export interface RecentFile {
  project: string;
  path: string;
  // Opened at, in ms since the epoch.
  at: number;
}

// What the home screen sorts and lists by: when each project was last opened
// and the files opened most recently, across projects.
export interface RecentsState {
  projects: Record<string, number>;
  // Most recent first, one entry per file.
  files: RecentFile[];
  touchProject(project: string): void;
  touchFile(project: string, path: string): void;
  // Drops a deleted project's history.
  forget(project: string): void;
  // Keeps the history of a renamed project.
  renameProject(from: string, to: string): void;
}

export const MAX_RECENT_FILES = 20;

export function createRecentsStore(storage: StateStorage, now: () => number = Date.now) {
  return createStore<RecentsState>()(
    persist(
      (set) => ({
        projects: {},
        files: [],
        touchProject: (project) => set((s) => ({ projects: { ...s.projects, [project]: now() } })),
        touchFile: (project, path) =>
          set((s) => ({
            files: [{ project, path, at: now() }, ...s.files.filter((f) => f.project !== project || f.path !== path)].slice(0, MAX_RECENT_FILES),
          })),
        forget: (project) =>
          set((s) => {
            const { [project]: _dropped, ...projects } = s.projects;
            return { projects, files: s.files.filter((f) => f.project !== project) };
          }),
        renameProject: (from, to) =>
          set((s) => {
            const { [from]: at, ...projects } = s.projects;
            return {
              projects: at === undefined ? projects : { ...projects, [to]: at },
              files: s.files.map((f) => (f.project === from ? { ...f, project: to } : f)),
            };
          }),
      }),
      {
        name: 'recents',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (s) => ({ projects: s.projects, files: s.files }),
      },
    ),
  );
}

// The app's store, in .tide/recents.json next to the other state. Lives here
// rather than in ./index so screens can import it without the whole state module.
export const recentsStore = createRecentsStore(createFsStorage(createExpoFs()));
export const useRecents = <T>(selector: (s: RecentsState) => T) => useStore(recentsStore, selector);

// "Just now", "2 min ago", "3 h ago", "Yesterday", "4 days ago", then a date.
export function timeAgo(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(at);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
