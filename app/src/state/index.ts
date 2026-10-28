import { useStore } from 'zustand';

import { createExpoFs } from '../features/files/expoFs';
import { createWorkspace } from '../features/files/workspace';
import { createProjectsStore, ProjectsState } from './projects';
import { createRunnerStore, RunnerState } from './runner';
import { createFsStorage } from './storage';
import { createTabsStore, TabsState } from './tabs';

const fs = createExpoFs();
const storage = createFsStorage(fs);

export const workspace = createWorkspace(fs);
export const tabsStore = createTabsStore(storage);
export const runnerStore = createRunnerStore(storage);
export const projectsStore = createProjectsStore(workspace, tabsStore);

export const useProjects = <T>(selector: (s: ProjectsState) => T) => useStore(projectsStore, selector);
export const useTabs = <T>(selector: (s: TabsState) => T) => useStore(tabsStore, selector);
export const useRunner = <T>(selector: (s: RunnerState) => T) => useStore(runnerStore, selector);
