import { createStore } from 'zustand';

import type { TreeNode, Workspace } from '../features/files/workspace';
import type { TabsState } from './tabs';

type TabsStore = { getState(): TabsState };

export interface ProjectsState {
  projects: string[];
  trees: Record<string, TreeNode[]>;
  loaded: boolean;
  refresh(): Promise<void>;
  createProject(name: string, templateId: string): Promise<string>;
  renameProject(name: string, newName: string): Promise<string>;
  deleteProject(name: string): Promise<void>;
  loadTree(project: string): Promise<void>;
  createFile(project: string, parent: string, name: string): Promise<string>;
  createFolder(project: string, parent: string, name: string): Promise<string>;
  renameEntry(project: string, path: string, newName: string): Promise<string>;
  deleteEntry(project: string, path: string): Promise<void>;
}

// The disk is the source of truth: every change goes through the workspace
// and then reloads what it touched, so nothing here needs persisting.
export function createProjectsStore(workspace: Workspace, tabs: TabsStore) {
  return createStore<ProjectsState>()((set, get) => {
    const reloadTree = async (project: string) => {
      const tree = await workspace.readTree(project);
      set((s) => ({ trees: { ...s.trees, [project]: tree } }));
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
      async renameProject(name, newName) {
        const project = await workspace.renameProject(name, newName);
        tabs.getState().renameProject(name, project);
        set((s) => {
          const { [name]: tree, ...rest } = s.trees;
          return { trees: tree ? { ...rest, [project]: tree } : rest };
        });
        await get().refresh();
        return project;
      },
      async deleteProject(name) {
        await workspace.deleteProject(name);
        tabs.getState().removeProject(name);
        set((s) => {
          const { [name]: _removed, ...rest } = s.trees;
          return { trees: rest };
        });
        await get().refresh();
      },
      loadTree: reloadTree,
      async createFile(project, parent, name) {
        const path = await workspace.createFile(project, parent, name);
        await reloadTree(project);
        tabs.getState().openTab(project, path);
        return path;
      },
      async createFolder(project, parent, name) {
        const path = await workspace.createFolder(project, parent, name);
        await reloadTree(project);
        return path;
      },
      async renameEntry(project, path, newName) {
        const to = await workspace.renameEntry(project, path, newName);
        tabs.getState().renamePath(project, path, to);
        await reloadTree(project);
        return to;
      },
      async deleteEntry(project, path) {
        await workspace.deleteEntry(project, path);
        tabs.getState().removePath(project, path);
        await reloadTree(project);
      },
    };
  });
}
