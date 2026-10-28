import type { DirEntry, EntryKind } from '../../files/fs';
import type { RunConfig } from '../../files/templates';
import type { Workspace } from '../../files/workspace';
import type { BuffersState } from '../../../state/buffers';
import type { ProjectsState } from '../../../state/projects';

// What the shell needs from the workspace. Writes go through the projects store
// so the file tree, open tabs and unsaved buffers stay in sync with the shell.
export interface ShellFs {
  stat(path: string): Promise<EntryKind | null>;
  list(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createFile(parent: string, name: string, content: string): Promise<void>;
  createFolder(parent: string, name: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  readRunConfig(): Promise<RunConfig | null>;
  // Reloads the file tree after something outside the shell changed files.
  refresh(): Promise<void>;
}

export function createShellFs(
  project: string,
  workspace: Workspace,
  projects: { getState(): ProjectsState },
  buffers: { getState(): BuffersState },
): ShellFs {
  const store = () => projects.getState();
  return {
    stat: (path) => workspace.stat(project, path),
    list: (path) => workspace.list(project, path),
    async readFile(path) {
      // Show what is in the editor, including edits that haven't autosaved yet.
      await buffers.getState().save(project, path);
      return workspace.readFile(project, path);
    },
    async writeFile(path, content) {
      await buffers.getState().replace(project, path, content);
      await store().loadTree(project);
    },
    async createFile(parent, name, content) {
      await workspace.createFile(project, parent, name, content);
      await store().loadTree(project);
    },
    async createFolder(parent, name) {
      await store().createFolder(project, parent, name);
    },
    remove: (path) => store().deleteEntry(project, path),
    move: async (from, to) => {
      await store().moveEntry(project, from, to);
    },
    copy: async (from, to) => {
      await store().copyEntry(project, from, to);
    },
    readRunConfig: () => workspace.readRunConfig(project),
    refresh: () => store().loadTree(project),
  };
}
