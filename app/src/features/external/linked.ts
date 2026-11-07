import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { BuffersState } from '../../state/buffers';
import { splitKey } from '../../state/buffers';
import type { Workspace } from '../files/workspace';
import type { Folder, Manifest, SyncResult } from './sync';
import { pull, push, pushFile } from './sync';

export interface Link {
  uri: string;
  // The folder's name, for showing; the URI is unreadable.
  name: string;
  manifest: Manifest;
  syncedAt: number | null;
  // Write each saved file straight to the folder.
  pushOnSave: boolean;
}

export interface LinkedState {
  links: Record<string, Link>;
  link(project: string, uri: string, name: string): void;
  unlink(project: string): void;
  update(project: string, patch: Partial<Link>): void;
  // Drops links of projects that no longer exist and follows renames.
  renameProject(from: string, to: string): void;
}

export function createLinkedStore(s: StateStorage) {
  return createStore<LinkedState>()(
    persist(
      (set) => ({
        links: {},
        link: (project, uri, name) =>
          set((st) => ({ links: { ...st.links, [project]: { uri, name, manifest: {}, syncedAt: null, pushOnSave: true } } })),
        unlink: (project) =>
          set((st) => {
            const links = { ...st.links };
            delete links[project];
            return { links };
          }),
        update: (project, patch) =>
          set((st) => (st.links[project] ? { links: { ...st.links, [project]: { ...st.links[project], ...patch } } } : st)),
        renameProject: (from, to) =>
          set((st) => {
            if (!st.links[from]) return st;
            const links = { ...st.links, [to]: st.links[from] };
            delete links[from];
            return { links };
          }),
      }),
      { name: 'linked-folders', version: 1, storage: createJSONStorage(() => s), partialize: ({ links }) => ({ links }) },
    ),
  );
}

export type LinkedStore = ReturnType<typeof createLinkedStore>;

// Pull, push and push-on-save for linked projects, with the folder access
// passed in so tests can use a folder in memory.
export function createLinkedSync(store: LinkedStore, workspace: Workspace, open: (uri: string) => Folder) {
  const run = async (project: string, sync: typeof pull): Promise<SyncResult> => {
    const link = store.getState().links[project];
    if (!link) throw new Error(`${project} isn't linked to a folder`);
    const result = await sync(open(link.uri), workspace, project, link.manifest);
    store.getState().update(project, { manifest: result.manifest, syncedAt: Date.now() });
    return result;
  };

  // Saves land in the folder as they happen, one write queue per project so
  // the manifest updates don't race.
  const queues = new Map<string, Promise<unknown>>();
  const saved = (project: string, path: string) => {
    const link = store.getState().links[project];
    if (!link?.pushOnSave) return;
    const next = (queues.get(project) ?? Promise.resolve())
      .then(async () => {
        const current = store.getState().links[project];
        if (!current) return;
        const manifest = await pushFile(open(current.uri), workspace, project, path, current.manifest);
        store.getState().update(project, { manifest });
      })
      .catch(() => undefined);
    queues.set(project, next);
  };

  return {
    pull: (project: string) => run(project, pull),
    push: (project: string) => run(project, push),
    saved,
    // Calls `saved` whenever a buffer's text reaches disk.
    watch(buffers: { subscribe(fn: (s: BuffersState, prev: BuffersState) => void): () => void }) {
      return buffers.subscribe((s, prev) => {
        for (const [key, b] of Object.entries(s.buffers)) {
          const before = prev.buffers[key];
          if (before && before.saved !== b.saved) saved(...splitKey(key));
        }
      });
    },
  };
}

export const useLinkedStore = <T>(store: LinkedStore, selector: (s: LinkedState) => T) => useStore(store, selector);
