import { appFs, buffersStore, onProjectChange } from '../../state';
import { splitKey } from '../../state/buffers';
import { createHistory } from './history';

export const fileHistory = createHistory(appFs);

// Every save of an open file adds to (or updates) its history.
buffersStore.subscribe((s, prev) => {
  for (const [key, b] of Object.entries(s.buffers)) {
    const before = prev.buffers[key];
    if (before && before.saved !== b.saved) {
      const [project, path] = splitKey(key);
      fileHistory.record(project, path, b.saved, before.saved);
    }
  }
});

onProjectChange({
  renamed: (from, to) => fileHistory.renameProject(from, to),
  deleted: (project) => fileHistory.removeProject(project),
  // Renames and moves in the tree take a file's (or a folder's) history along;
  // a delete, or a new file at an old path, starts it afresh.
  pathRenamed: (project, from, to) => fileHistory.renamePath(project, from, to),
  pathRemoved: (project, path) => fileHistory.removePath(project, path),
});
