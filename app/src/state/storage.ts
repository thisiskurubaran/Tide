import type { StateStorage } from 'zustand/middleware';

import { FsAdapter, joinPath } from '../features/files/fs';

// App state lives next to the projects folder, not inside it, so it never
// shows up in a project tree or gets synced to a remote container.
export const STATE_DIR = '.tide';

export function createFsStorage(fs: FsAdapter): StateStorage<Promise<void>> {
  const path = (name: string) => joinPath(STATE_DIR, `${name}.json`);
  return {
    async getItem(name) {
      return (await fs.stat(path(name))) === 'file' ? fs.readFile(path(name)) : null;
    },
    async setItem(name, value) {
      await fs.writeFile(path(name), value);
    },
    async removeItem(name) {
      if (await fs.stat(path(name))) await fs.remove(path(name));
    },
  };
}
