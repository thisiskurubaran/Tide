// The agent's pending changes as the app keeps them: wired to the real
// workspace and editors, and saved in app state (.tide) so changes applied to
// disk by run_command can still be reviewed or undone after a relaunch.
import { useStore } from 'zustand';

import { fileHistory } from '../history';
import { buffersStore, projectsStore, storage, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { ChangeIo, createChangesStore } from './changes';

// Files: what the user has, open editor text included.

export async function readCurrent(project: string, path: string): Promise<string | null> {
  const buffer = buffersStore.getState().buffers[bufferKey(project, path)];
  if (buffer) return buffer.content;
  if ((await workspace.stat(project, path).catch(() => null)) !== 'file') return null;
  return workspace.readFile(project, path);
}

async function ensureFolder(project: string, dir: string) {
  let at = '';
  for (const part of dir.split('/').filter(Boolean)) {
    const next = at ? `${at}/${part}` : part;
    if ((await workspace.stat(project, next)) !== 'dir') await workspace.createFolder(project, at, part);
    at = next;
  }
}

// Writes go through the buffers store so open editors show the new text.
const changeIo: ChangeIo = {
  read: readCurrent,
  async write(project, path, content) {
    const kind = await workspace.stat(project, path).catch(() => null);
    if (content === null) {
      if (kind) await projectsStore.getState().deleteEntry(project, path);
      return;
    }
    if (kind === 'file') {
      await buffersStore.getState().replace(project, path, content);
      return;
    }
    const slash = path.lastIndexOf('/');
    const dir = slash < 0 ? '' : path.slice(0, slash);
    await ensureFolder(project, dir);
    await workspace.createFile(project, dir, path.slice(slash + 1), content);
    await projectsStore.getState().loadTree(project);
  },
  recordHistory: (project, path, content, before) => fileHistory.record(project, path, content, before ?? undefined),
};

// Saved in app state so unreviewed changes survive the app being killed.
export const changesStore = createChangesStore(changeIo, storage);
export const useChanges = <T>(selector: (s: ReturnType<typeof changesStore.getState>) => T) => useStore(changesStore, selector);

projectsStore.subscribe((s, prev) => {
  // Deleted projects take their pending changes with them.
  for (const p of prev.projects) if (prev.loaded && s.loaded && !s.projects.includes(p)) changesStore.getState().forget(p);
});
