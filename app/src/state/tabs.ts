import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

export interface ProjectTabs {
  open: string[];
  active: string | null;
}

export interface TabsState {
  byProject: Record<string, ProjectTabs>;
  // Last opened project, so a restart lands back where the user was.
  lastProject: string | null;
  openTab(project: string, path: string): void;
  closeTab(project: string, path: string): void;
  setLastProject(project: string | null): void;
  // Keep tabs pointing at the right files after a rename or delete in the tree.
  renamePath(project: string, from: string, to: string): void;
  removePath(project: string, path: string): void;
  renameProject(from: string, to: string): void;
  removeProject(project: string): void;
}

const empty: ProjectTabs = { open: [], active: null };

const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function createTabsStore(storage: StateStorage) {
  return createStore<TabsState>()(
    persist(
      (set) => {
        const update = (project: string, fn: (tabs: ProjectTabs) => ProjectTabs) =>
          set((s) => ({ byProject: { ...s.byProject, [project]: fn(s.byProject[project] ?? empty) } }));

        return {
          byProject: {},
          lastProject: null,
          openTab: (project, path) =>
            update(project, (t) => ({ open: t.open.includes(path) ? t.open : [...t.open, path], active: path })),
          closeTab: (project, path) =>
            update(project, (t) => {
              const i = t.open.indexOf(path);
              if (i === -1) return t;
              const open = t.open.filter((p) => p !== path);
              // Closing the active tab focuses its neighbour, like most editors.
              const active = t.active === path ? (open[i] ?? open[i - 1] ?? null) : t.active;
              return { open, active };
            }),
          setLastProject: (project) => set({ lastProject: project }),
          renamePath: (project, from, to) =>
            update(project, (t) => {
              const move = (p: string) => (isUnder(p, from) ? to + p.slice(from.length) : p);
              return { open: t.open.map(move), active: t.active && move(t.active) };
            }),
          removePath: (project, path) =>
            update(project, (t) => {
              const open = t.open.filter((p) => !isUnder(p, path));
              return { open, active: t.active && !isUnder(t.active, path) ? t.active : (open[0] ?? null) };
            }),
          renameProject: (from, to) =>
            set((s) => {
              const { [from]: tabs, ...rest } = s.byProject;
              return {
                byProject: tabs ? { ...rest, [to]: tabs } : rest,
                lastProject: s.lastProject === from ? to : s.lastProject,
              };
            }),
          removeProject: (project) =>
            set((s) => {
              const { [project]: _removed, ...rest } = s.byProject;
              return { byProject: rest, lastProject: s.lastProject === project ? null : s.lastProject };
            }),
        };
      },
      {
        name: 'tabs',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (s) => ({ byProject: s.byProject, lastProject: s.lastProject }),
      },
    ),
  );
}

export function projectTabs(state: TabsState, project: string): ProjectTabs {
  return state.byProject[project] ?? empty;
}
