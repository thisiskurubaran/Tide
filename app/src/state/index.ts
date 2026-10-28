import { useStore } from 'zustand';

import { createExpoFs } from '../features/files/expoFs';
import { createWorkspace } from '../features/files/workspace';
import { BuffersState, createBuffersStore } from './buffers';
import { createProjectsStore, ProjectsState } from './projects';
import { createRunnerStore, RunnerState } from './runner';
import { createFsStorage } from './storage';
import { createTabsStore, TabsState } from './tabs';

const fs = createExpoFs();
const storage = createFsStorage(fs);

export const workspace = createWorkspace(fs);
export const tabsStore = createTabsStore(storage);
export const runnerStore = createRunnerStore(storage);
export const buffersStore = createBuffersStore(workspace);
export const projectsStore = createProjectsStore(workspace, tabsStore, buffersStore);

export const useProjects = <T>(selector: (s: ProjectsState) => T) => useStore(projectsStore, selector);
export const useTabs = <T>(selector: (s: TabsState) => T) => useStore(tabsStore, selector);
export const useBuffers = <T>(selector: (s: BuffersState) => T) => useStore(buffersStore, selector);
export const useRunner = <T>(selector: (s: RunnerState) => T) => useStore(runnerStore, selector);
