import type { StateStorage } from 'zustand/middleware';

import { FsAdapter, joinPath } from '../features/files/fs';

// App state lives next to the projects folder, not inside it, so it never
// shows up in a project tree or gets synced to a remote container.
export const STATE_DIR = '.tide';

const parses = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

// State files are JSON. A file that doesn't parse (empty or cut short, e.g. the
// app was killed mid-write) would stop the store from ever hydrating, which
// leaves the app on the splash screen; it is moved aside and the defaults load.
//
// Writes go to name.json.tmp first and replace name.json only once complete,
// so a write cut short never damages the last good file. If the app dies
// between removing the old file and renaming the new one, the next read picks
// up the complete .tmp.
export function createFsStorage(fs: FsAdapter): StateStorage<Promise<void>> {
  const file = (name: string) => `${name}.json`;
  const path = (name: string) => joinPath(STATE_DIR, file(name));
  const tmp = (name: string) => `${path(name)}.tmp`;
  const queues = new Map<string, Promise<void>>();

  const readValid = async (p: string): Promise<string | null | 'corrupt'> => {
    if ((await fs.stat(p)) !== 'file') return null;
    const text = await fs.readFile(p);
    return parses(text) ? text : 'corrupt';
  };

  const moveAside = async (name: string) => {
    const corrupt = `${file(name)}.corrupt`;
    try {
      if (await fs.stat(joinPath(STATE_DIR, corrupt))) await fs.remove(joinPath(STATE_DIR, corrupt));
      await fs.rename(path(name), corrupt);
    } catch (e) {
      await fs.remove(path(name)).catch(() => undefined);
      console.warn(`Could not keep a copy of the damaged ${file(name)}`, e);
    }
  };

  return {
    async getItem(name) {
      // Not in the middle of this process's own write (old file removed, new one not yet renamed).
      await queues.get(name)?.catch(() => undefined);
      let main: string | null | 'corrupt';
      try {
        main = await readValid(path(name));
      } catch (e) {
        console.warn(`Could not read ${file(name)}`, e);
        main = 'corrupt';
      }
      if (main !== null && main !== 'corrupt') return main;
      if (main === 'corrupt') {
        console.warn(`${file(name)} is damaged; moved it to ${file(name)}.corrupt and starting from defaults`);
        await moveAside(name);
      }
      // A complete write that didn't get renamed into place.
      const pending = await readValid(tmp(name)).catch(() => 'corrupt' as const);
      if (pending !== null && pending !== 'corrupt') {
        await fs.rename(tmp(name), file(name)).catch(() => undefined);
        return pending;
      }
      return null;
    },
    setItem(name, value) {
      // One write per file at a time, in order, so a slower earlier write can't
      // land after a later one or rename the later one's .tmp away.
      const next = (queues.get(name) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        await fs.writeFile(tmp(name), value);
        if (await fs.stat(path(name))) await fs.remove(path(name));
        await fs.rename(tmp(name), file(name));
      });
      queues.set(name, next);
      next.finally(() => queues.get(name) === next && queues.delete(name)).catch(() => undefined);
      return next;
    },
    async removeItem(name) {
      if (await fs.stat(path(name))) await fs.remove(path(name));
      if (await fs.stat(tmp(name))) await fs.remove(tmp(name));
    },
  };
}
