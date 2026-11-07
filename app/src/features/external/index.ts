import { useStore } from 'zustand';

import { buffersStore, onProjectChange, projectsStore, snapshots, storage, tabsStore, workspace } from '../../state';
import { projectTabs } from '../../state/tabs';
import { folderAt, pickFolder } from './folder';
import { createLinkedStore, createLinkedSync, LinkedState } from './linked';

export const linkedStore = createLinkedStore(storage);
export const linkedSync = createLinkedSync(linkedStore, workspace, folderAt);
export const useLinked = <T>(selector: (s: LinkedState) => T) => useStore(linkedStore, selector);

linkedSync.watch(buffersStore);
onProjectChange({
  renamed: async (from, to) => linkedStore.getState().renameProject(from, to),
  deleted: async (project) => linkedStore.getState().unlink(project),
});

// New project from a folder: link it and copy the folder in.
export async function openFolderAsProject(name: string): Promise<string> {
  const folder = await pickFolder();
  return projectsStore.getState().cloneProject(name || folder.name, async (project) => {
    linkedStore.getState().link(project, folder.uri, folder.name);
    try {
      await linkedSync.pull(project);
    } catch (e) {
      linkedStore.getState().unlink(project);
      throw e;
    }
  });
}

export async function linkFolder(project: string): Promise<void> {
  const folder = await pickFolder();
  linkedStore.getState().link(project, folder.uri, folder.name);
}

// iOS forgets access to an outside folder when the app restarts; picking it
// again (the picker opens there) grants it anew.
export async function regrantFolder(project: string): Promise<void> {
  const link = linkedStore.getState().links[project];
  const folder = await pickFolder(link?.uri);
  linkedStore.getState().update(project, { uri: folder.uri, name: folder.name });
}

// Folder -> project, with a snapshot first since pull overwrites files here.
export async function pullFolder(project: string) {
  await buffersStore.getState().flushProject(project);
  await snapshots.take(project, 'before-pull');
  const result = await linkedSync.pull(project);
  await projectsStore.getState().loadTree(project);
  const open = projectTabs(tabsStore.getState(), project).open;
  await Promise.all(open.map((path) => buffersStore.getState().reload(project, path)));
  return result;
}

export async function pushFolder(project: string) {
  await buffersStore.getState().flushProject(project);
  return linkedSync.push(project);
}
