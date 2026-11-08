import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

export interface ProjectTabs {
  // Pinned tabs always come first, in the order they were pinned.
  open: string[];
  active: string | null;
  // Left out while nothing is pinned.
  pinned?: string[];
}

// A closed tab, kept so it can be reopened where it was.
export interface ClosedTab {
  path: string;
  index: number;
  pinned?: boolean;
}

export interface TabsState {
  byProject: Record<string, ProjectTabs>;
  // Recently closed tabs per project, most recent first.
  closed: Record<string, ClosedTab[]>;
  // Last opened project, so a restart lands back where the user was.
  lastProject: string | null;
  // Most recently opened first; feeds the home screen quick actions.
  recent: string[];
  // `activate: false` adds the tab without showing it, e.g. for the second editor pane.
  openTab(project: string, path: string, activate?: boolean): void;
  closeTab(project: string, path: string): void;
  // Reopens the most recently closed tab whose file `exists` still finds, at
  // its old place, and forgets the ones that are gone. Resolves to its path.
  reopenClosedTab(project: string, exists: (path: string) => Promise<boolean>, activate?: boolean): Promise<string | null>;
  pinTab(project: string, path: string): void;
  unpinTab(project: string, path: string): void;
  setLastProject(project: string | null): void;
  // Keep tabs pointing at the right files after a rename or delete in the tree.
  renamePath(project: string, from: string, to: string): void;
  removePath(project: string, path: string): void;
  renameProject(from: string, to: string): void;
  removeProject(project: string): void;
}

const MAX_RECENT = 5;
export const MAX_CLOSED = 20;

const empty: ProjectTabs = { open: [], active: null };

const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

const pinnedOf = (t: ProjectTabs) => t.pinned ?? [];
export const isPinned = (t: ProjectTabs, path: string) => pinnedOf(t).includes(path);

// Builds tabs with the pinned ones first, leaving `pinned` out when empty so
// unpinned projects look the same as before pinning existed.
function make(open: string[], active: string | null, pinned: string[]): ProjectTabs {
  const pins = pinned.filter((p) => open.includes(p));
  const ordered = pins.length ? [...pins, ...open.filter((p) => !pins.includes(p))] : open;
  return pins.length ? { open: ordered, active, pinned: pins } : { open: ordered, active };
}

// The tabs "Close other tabs" closes: all but `keep` and the pinned ones.
export function othersToClose(t: ProjectTabs, keep: string | null): string[] {
  return t.open.filter((p) => p !== keep && !isPinned(t, p));
}

// `opened` hears every file a tab is opened for, e.g. to record recent files.
export function createTabsStore(storage: StateStorage, hooks: { opened?(project: string, path: string): void } = {}) {
  return createStore<TabsState>()(
    persist(
      (set, get) => {
        const update = (project: string, fn: (tabs: ProjectTabs) => ProjectTabs) =>
          set((s) => ({ byProject: { ...s.byProject, [project]: fn(s.byProject[project] ?? empty) } }));
        const updateClosed = (project: string, fn: (closed: ClosedTab[]) => ClosedTab[]) =>
          set((s) => ({ closed: { ...s.closed, [project]: fn(s.closed[project] ?? []) } }));

        return {
          byProject: {},
          closed: {},
          lastProject: null,
          recent: [],
          openTab: (project, path, activate = true) => {
            update(project, (t) => make(t.open.includes(path) ? t.open : [...t.open, path], activate ? path : t.active, pinnedOf(t)));
            hooks.opened?.(project, path);
          },
          closeTab: (project, path) => {
            const before = get().byProject[project] ?? empty;
            const i = before.open.indexOf(path);
            if (i === -1) return;
            const pinned = isPinned(before, path);
            update(project, (t) => {
              const open = t.open.filter((p) => p !== path);
              // Closing the active tab focuses its neighbour, like most editors.
              const active = t.active === path ? (open[i] ?? open[i - 1] ?? null) : t.active;
              return make(open, active, pinnedOf(t));
            });
            updateClosed(project, (c) => [{ path, index: i, ...(pinned ? { pinned } : {}) }, ...c.filter((x) => x.path !== path)].slice(0, MAX_CLOSED));
          },
          reopenClosedTab: async (project, exists, activate = true) => {
            const tried = new Set<string>();
            for (;;) {
              const next = (get().closed[project] ?? []).find((c) => !tried.has(c.path) && !(get().byProject[project] ?? empty).open.includes(c.path));
              if (!next) return null;
              tried.add(next.path);
              const found = await exists(next.path).catch(() => false);
              updateClosed(project, (c) => c.filter((x) => x.path !== next.path));
              if (!found) continue;
              update(project, (t) => {
                if (t.open.includes(next.path)) return activate ? { ...t, active: next.path } : t;
                const pins = pinnedOf(t).filter((p) => t.open.includes(p));
                // Back where it was, but on its own side of the pinned tabs.
                const at = next.pinned ? Math.min(next.index, pins.length) : Math.min(Math.max(next.index, pins.length), t.open.length);
                const open = [...t.open.slice(0, at), next.path, ...t.open.slice(at)];
                const pinned = next.pinned ? [...pins.slice(0, at), next.path, ...pins.slice(at)] : pins;
                return make(open, activate ? next.path : t.active, pinned);
              });
              hooks.opened?.(project, next.path);
              return next.path;
            }
          },
          pinTab: (project, path) =>
            update(project, (t) => {
              if (!t.open.includes(path) || isPinned(t, path)) return t;
              return make(t.open, t.active, [...pinnedOf(t), path]);
            }),
          unpinTab: (project, path) =>
            update(project, (t) => {
              if (!isPinned(t, path)) return t;
              const pinned = pinnedOf(t).filter((p) => p !== path);
              // It becomes the first unpinned tab, right after the pinned ones.
              const rest = t.open.filter((p) => p !== path && !pinned.includes(p));
              return make([...pinned, path, ...rest], t.active, pinned);
            }),
          setLastProject: (project) =>
            set((s) => ({ lastProject: project, recent: project ? [project, ...s.recent.filter((p) => p !== project)].slice(0, MAX_RECENT) : s.recent })),
          renamePath: (project, from, to) => {
            const move = (p: string) => (isUnder(p, from) ? to + p.slice(from.length) : p);
            update(project, (t) => make(t.open.map(move), t.active && move(t.active), pinnedOf(t).map(move)));
            if (get().closed[project]) updateClosed(project, (c) => c.map((x) => ({ ...x, path: move(x.path) })));
          },
          removePath: (project, path) => {
            update(project, (t) => {
              const open = t.open.filter((p) => !isUnder(p, path));
              return make(open, t.active && !isUnder(t.active, path) ? t.active : (open[0] ?? null), pinnedOf(t));
            });
            if (get().closed[project]) updateClosed(project, (c) => c.filter((x) => !isUnder(x.path, path)));
          },
          renameProject: (from, to) =>
            set((s) => {
              const { [from]: tabs, ...rest } = s.byProject;
              const { [from]: closed, ...restClosed } = s.closed;
              return {
                byProject: tabs ? { ...rest, [to]: tabs } : rest,
                closed: closed ? { ...restClosed, [to]: closed } : restClosed,
                lastProject: s.lastProject === from ? to : s.lastProject,
                recent: s.recent.map((p) => (p === from ? to : p)),
              };
            }),
          removeProject: (project) =>
            set((s) => {
              const { [project]: _removed, ...rest } = s.byProject;
              const { [project]: _closed, ...restClosed } = s.closed;
              return {
                byProject: rest,
                closed: restClosed,
                lastProject: s.lastProject === project ? null : s.lastProject,
                recent: s.recent.filter((p) => p !== project),
              };
            }),
        };
      },
      {
        name: 'tabs',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: (s) => ({ byProject: s.byProject, closed: s.closed, lastProject: s.lastProject, recent: s.recent }),
      },
    ),
  );
}

export function projectTabs(state: TabsState, project: string): ProjectTabs {
  return state.byProject[project] ?? empty;
}
