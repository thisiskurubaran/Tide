// The agent's pending changes as the app keeps them: wired to the real
// workspace and editors, and saved in app state (.tide) so changes applied to
// disk by run_command can still be reviewed or undone after a relaunch.
import { AppState } from 'react-native';
import { useStore } from 'zustand';

import { fileHistory } from '../history';
import { buffersStore, onProjectChange, projectsStore, storage, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { hydrated } from '../../state/hydrated';
import { commandApprovals } from './approvalsStore';
import { ChangeIo, createChangesStore } from './changes';
import { folderIdentity } from './projectIdentity';

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
export const changesStore = createChangesStore(changeIo, storage, { identify: folderIdentity });
export const useChanges = <T>(selector: (s: ReturnType<typeof changesStore.getState>) => T) => useStore(changesStore, selector);

// Pending changes and command approvals follow a rename and go with a delete
// made in Tide.
onProjectChange({
  renamed: async (from, to) => {
    changesStore.getState().renameProject(from, to);
    await commandApprovals.renameProject(from, to);
  },
  deleted: async (project) => {
    changesStore.getState().forget(project);
    await commandApprovals.forget(project);
  },
});

// Once loaded, saved changes are checked against the projects and their files:
// a project deleted in the Files app (and maybe made again under the same
// name) doesn't get them back, and `disk` is taken from the files themselves.
hydrated(changesStore)
  .then(() => changesStore.getState().reconcileAll())
  .catch(() => undefined);

// A project showing up (made again, or put back by the Files app) is checked too.
// One disappearing isn't: a rename makes the old name disappear for a moment.
projectsStore.subscribe((s, prev) => {
  if (!s.loaded || s.projects === prev.projects) return;
  for (const p of s.projects) {
    if (!prev.projects.includes(p) && changesStore.getState().byProject[p]) changesStore.getState().reconcile(p).catch(() => undefined);
  }
});

// Saves are coalesced; one waiting is written before the app may be suspended.
AppState.addEventListener('change', (state) => {
  if (state !== 'active') changesStore.getState().flush().catch(() => undefined);
});
