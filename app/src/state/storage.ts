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

// How long a read may take before the store gives up on it and starts from
// defaults (with saving turned off, see below).
export const READ_TIMEOUT_MS = 5000;

// State files are JSON. A file that doesn't parse (empty or cut short, e.g. the
// app was killed mid-write) would stop the store from ever hydrating, which
// leaves the app on the splash screen; it is moved aside and the defaults load.
//
// Writes go to name.json.tmp first and replace name.json only once complete,
// so a write cut short never damages the last good file. If the app dies
// between writing the .tmp and renaming it into place, the .tmp is the newest
// complete write, and the next read picks it up.
//
// zustand's persist writes on every change, even before the saved state has
// loaded, and those writes hold defaults. So writes to a file are dropped
// while it is being read, and for the rest of the launch if it couldn't be
// read (an I/O error or a timeout, which is not damage: the file is left where
// it is and the store runs on defaults without overwriting it). A file that
// was never read (a direct setItem) is written as usual.
export function createFsStorage(fs: FsAdapter, { readTimeoutMs = READ_TIMEOUT_MS } = {}): StateStorage<Promise<void>> {
  const file = (name: string) => `${name}.json`;
  const path = (name: string) => joinPath(STATE_DIR, file(name));
  const tmp = (name: string) => `${path(name)}.tmp`;
  const queues = new Map<string, Promise<void>>();
  // Absent: never read. 'reading' and 'failed' block writes.
  const reads = new Map<string, 'reading' | 'ok' | 'failed'>();
  const reported = new Set<string>();

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

  // Throws only on I/O errors; damage is handled here.
  const read = async (name: string): Promise<string | null> => {
    // Not in the middle of this process's own write (old file removed, new one not yet renamed).
    await queues.get(name)?.catch(() => undefined);
    // A complete .tmp is newer than name.json: the write got that far before the app died.
    const pending = await readValid(tmp(name));
    if (pending !== null && pending !== 'corrupt') {
      try {
        if (await fs.stat(path(name))) await fs.remove(path(name));
        await fs.rename(tmp(name), file(name));
      } catch (e) {
        console.warn(`Could not move ${file(name)}.tmp into place`, e);
      }
      return pending;
    }
    const main = await readValid(path(name));
    if (main === 'corrupt') {
      console.warn(`${file(name)} is damaged; moved it to ${file(name)}.corrupt and starting from defaults`);
      await moveAside(name);
      return null;
    }
    return main;
  };

  return {
    async getItem(name) {
      reads.set(name, 'reading');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          read(name),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`timed out after ${readTimeoutMs} ms`)), readTimeoutMs);
          }),
        ]);
        reads.set(name, 'ok');
        return value;
      } catch (e) {
        // Not damage: leave the file alone and don't overwrite it this launch.
        reads.set(name, 'failed');
        console.warn(`Could not read ${file(name)}; starting from defaults and not saving changes to it until the next launch`, e);
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    setItem(name, value) {
      const status = reads.get(name);
      if (status === 'reading' || status === 'failed') {
        if (status === 'failed' && !reported.has(name)) {
          reported.add(name);
          console.warn(`Not saving ${file(name)}: it could not be read, and saving would replace it with defaults`);
        }
        return Promise.resolve();
      }
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
