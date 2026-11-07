import { useStore } from 'zustand';

import { createSnapshots } from '../features/backup/snapshots';
import { createExpoFs } from '../features/files/expoFs';
import { createWorkspace } from '../features/files/workspace';
import { AUTOSAVE_MS, BuffersState, createBuffersStore } from './buffers';
import { createProjectsStore, ProjectHooks, ProjectsState } from './projects';
import { recentsStore } from './recents';
import { createRunnerStore, RunnerState } from './runner';
import { createSettingsStore, SettingsState } from './settings';
import { createFsStorage } from './storage';
import { createTabsStore, TabsState } from './tabs';

// The Documents directory; backups use it for .tide/snapshots.
export const appFs = createExpoFs();
const fs = appFs;
export const storage = createFsStorage(fs);

export const workspace = createWorkspace(fs);
// Last opened projects and files, for the home screen.
export { recentsStore, useRecents } from './recents';
export const tabsStore = createTabsStore(storage, { opened: (project, path) => recentsStore.getState().touchFile(project, path) });
export const runnerStore = createRunnerStore(storage);
export const settingsStore = createSettingsStore(storage);
// A file deleted on disk (git, a snapshot restore, rm) closes its tab, as a
// delete in the file tree does, unless it has unsaved edits.
export const buffersStore = createBuffersStore(workspace, AUTOSAVE_MS, { gone: (project, path) => tabsStore.getState().removePath(project, path) });
export const snapshots = createSnapshots(appFs, workspace);
// Features that keep per-project data elsewhere follow renames and deletes here.
const projectHooks: ProjectHooks[] = [
  { renamed: (from, to) => snapshots.renameProject(from, to), deleted: (project) => snapshots.removeProject(project) },
  {
    renamed: async (from, to) => recentsStore.getState().renameProject(from, to),
    deleted: async (project) => recentsStore.getState().forget(project),
  },
];
export const onProjectChange = (hooks: ProjectHooks) => projectHooks.push(hooks);
export const projectsStore = createProjectsStore(workspace, tabsStore, buffersStore, {
  renamed: async (from, to) => {
    for (const h of projectHooks) await h.renamed?.(from, to).catch(() => undefined);
  },
  deleted: async (project) => {
    for (const h of projectHooks) await h.deleted?.(project).catch(() => undefined);
  },
});

export const useProjects = <T>(selector: (s: ProjectsState) => T) => useStore(projectsStore, selector);
export const useTabs = <T>(selector: (s: TabsState) => T) => useStore(tabsStore, selector);
export const useBuffers = <T>(selector: (s: BuffersState) => T) => useStore(buffersStore, selector);
export const useRunner = <T>(selector: (s: RunnerState) => T) => useStore(runnerStore, selector);
export const useSettings = <T>(selector: (s: SettingsState) => T) => useStore(settingsStore, selector);
