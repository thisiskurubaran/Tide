import { createStore } from 'zustand';

import type { TreeNode, Workspace } from '../features/files/workspace';
import type { BuffersState } from './buffers';
import type { TabsState } from './tabs';

type TabsStore = { getState(): TabsState };
type BuffersStore = { getState(): BuffersState };

export interface ProjectsState {
  projects: string[];
  trees: Record<string, TreeNode[]>;
  loaded: boolean;
  refresh(): Promise<void>;
  createProject(name: string, templateId: string): Promise<string>;
  // Creates an empty project and runs `clone` in it; removes the project if that fails.
  cloneProject(name: string, clone: (project: string) => Promise<void>): Promise<string>;
  renameProject(name: string, newName: string): Promise<string>;
  deleteProject(name: string): Promise<void>;
  loadTree(project: string): Promise<void>;
  createFile(project: string, parent: string, name: string): Promise<string>;
  createFolder(project: string, parent: string, name: string): Promise<string>;
  renameEntry(project: string, path: string, newName: string): Promise<string>;
  deleteEntry(project: string, path: string): Promise<void>;
  moveEntry(project: string, from: string, to: string): Promise<string>;
  copyEntry(project: string, from: string, to: string): Promise<string>;
}

// The disk is the source of truth: every change goes through the workspace
// and then reloads what it touched, so nothing here needs persisting.
// Pending autosaves are flushed before a rename and dropped before a delete,
// otherwise a late write would recreate the old file.
// Other per-project data (snapshots) that has to follow a rename or delete.
export interface ProjectHooks {
  renamed?(from: string, to: string): Promise<void>;
  deleted?(project: string): Promise<void>;
  // A file or folder in the tree was renamed or moved (local history follows it).
  pathRenamed?(project: string, from: string, to: string): Promise<void>;
  // A file or folder was deleted in the tree, or a new file was created where
  // an old one may have been: data kept for the old path doesn't carry over.
  pathRemoved?(project: string, path: string): Promise<void>;
}

export function createProjectsStore(workspace: Workspace, tabs: TabsStore, buffers: BuffersStore, hooks: ProjectHooks = {}) {
  return createStore<ProjectsState>()((set, get) => {
    const reloadTree = async (project: string) => {
      const tree = await workspace.readTree(project);
      set((s) => ({ trees: { ...s.trees, [project]: tree } }));
    };

    // Rename or move: tabs, buffers and local history follow. While it runs,
    // a reload that finds the old path missing doesn't close its tab.
    const relocate = async (project: string, from: string, move: () => Promise<string>) => {
      await buffers.getState().flushProject(project);
      const release = buffers.getState().hold(project, from);
      try {
        const to = await move();
        tabs.getState().renamePath(project, from, to);
        buffers.getState().renamePath(project, from, to);
        if (to !== from) await hooks.pathRenamed?.(project, from, to).catch(() => undefined);
        await reloadTree(project);
        return to;
      } finally {
        release();
      }
    };

    return {
      projects: [],
      trees: {},
      loaded: false,
      async refresh() {
        set({ projects: await workspace.listProjects(), loaded: true });
      },
      async createProject(name, templateId) {
        const project = await workspace.createProject(name, templateId);
        await get().refresh();
        return project;
      },
      async cloneProject(name, clone) {
        const project = await workspace.createEmptyProject(name);
        try {
          await clone(project);
        } catch (e) {
          await workspace.deleteProject(project).catch(() => undefined);
          throw e;
        }
        await get().refresh();
        return project;
      },
      async renameProject(name, newName) {
        await buffers.getState().flushProject(name);
        const project = await workspace.renameProject(name, newName);
        tabs.getState().renameProject(name, project);
        buffers.getState().renameProject(name, project);
        await hooks.renamed?.(name, project).catch(() => undefined);
        set((s) => {
          const { [name]: tree, ...rest } = s.trees;
          return { trees: tree ? { ...rest, [project]: tree } : rest };
        });
        await get().refresh();
        return project;
      },
      async deleteProject(name) {
        buffers.getState().removeProject(name);
        await workspace.deleteProject(name);
        tabs.getState().removeProject(name);
        await hooks.deleted?.(name).catch(() => undefined);
        set((s) => {
          const { [name]: _removed, ...rest } = s.trees;
          return { trees: rest };
        });
        await get().refresh();
      },
      loadTree: reloadTree,
      async createFile(project, parent, name) {
        const path = await workspace.createFile(project, parent, name);
        await hooks.pathRemoved?.(project, path).catch(() => undefined);
        await reloadTree(project);
        tabs.getState().openTab(project, path);
        return path;
      },
      async createFolder(project, parent, name) {
        const path = await workspace.createFolder(project, parent, name);
        await reloadTree(project);
        return path;
      },
      renameEntry: (project, path, newName) => relocate(project, path, () => workspace.renameEntry(project, path, newName)),
      moveEntry: (project, from, to) => relocate(project, from, () => workspace.moveEntry(project, from, to)),
      async copyEntry(project, from, to) {
        // Copy what the user sees in the editor, not a stale file.
        await buffers.getState().flushProject(project);
        const target = await workspace.copyEntry(project, from, to);
        await reloadTree(project);
        return target;
      },
      async deleteEntry(project, path) {
        // Delete first: if it fails, the open tab and its buffer stay as they
        // were, so typing in it is still saved. An autosave that lands
        // meanwhile finds no file and keeps its edits (see buffers.ts).
        await workspace.deleteEntry(project, path);
        buffers.getState().removePath(project, path);
        tabs.getState().removePath(project, path);
        await hooks.pathRemoved?.(project, path).catch(() => undefined);
        await reloadTree(project);
      },
    };
  });
}
