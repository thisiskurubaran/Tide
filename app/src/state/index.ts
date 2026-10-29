import { useStore } from 'zustand';

import { createSnapshots } from '../features/backup/snapshots';
import { createExpoFs } from '../features/files/expoFs';
import { createWorkspace } from '../features/files/workspace';
import { BuffersState, createBuffersStore } from './buffers';
import { createProjectsStore, ProjectsState } from './projects';
import { createRunnerStore, RunnerState } from './runner';
import { createSettingsStore, SettingsState } from './settings';
import { createFsStorage } from './storage';
import { createTabsStore, TabsState } from './tabs';

// The Documents directory; backups use it for .tide/snapshots.
export const appFs = createExpoFs();
const fs = appFs;
export const storage = createFsStorage(fs);

export const workspace = createWorkspace(fs);
export const tabsStore = createTabsStore(storage);
export const runnerStore = createRunnerStore(storage);
export const settingsStore = createSettingsStore(storage);
export const buffersStore = createBuffersStore(workspace);
export const snapshots = createSnapshots(appFs, workspace);
export const projectsStore = createProjectsStore(workspace, tabsStore, buffersStore, {
  renamed: (from, to) => snapshots.renameProject(from, to),
  deleted: (project) => snapshots.removeProject(project),
});

export const useProjects = <T>(selector: (s: ProjectsState) => T) => useStore(projectsStore, selector);
export const useTabs = <T>(selector: (s: TabsState) => T) => useStore(tabsStore, selector);
export const useBuffers = <T>(selector: (s: BuffersState) => T) => useStore(buffersStore, selector);
export const useRunner = <T>(selector: (s: RunnerState) => T) => useStore(runnerStore, selector);
export const useSettings = <T>(selector: (s: SettingsState) => T) => useStore(settingsStore, selector);
