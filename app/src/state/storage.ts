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
// while it is being read, and after a failed read until a later read succeeds
// (an I/O error or a timeout, which is not damage: the file is left where it
// is and the store runs on defaults without overwriting it). A file that
// was never read (a direct setItem) is written as usual.
//
// A dropped write resolves quietly for persist (it writes on every change and
// doesn't look at the result). A caller that needs the write on disk (the
// agent saving its intent before changing project files) uses setItemStrict,
// which rejects with StateNotSavedError instead, or asks isBlocked first.
//
// A read that timed out keeps going in the background. If it then succeeds,
// the file is readable after all: listeners (onStateFileReadable, used by
// hydrated.ts) are told so the store can load it again, and that new read
// re-opens writes. Until then writes stay blocked.

// A write was skipped because the file's saved state hasn't loaded.
export class StateNotSavedError extends Error {
  constructor(readonly file: string) {
    super(`${file} was not saved: its saved state hasn't loaded, and saving would replace it`);
  }
}

export interface FsStorage extends StateStorage<Promise<void>> {
  // Like setItem, but rejects with StateNotSavedError when the write is skipped.
  setItemStrict(name: string, value: string): Promise<void>;
  // Whether a setItem now would be skipped (the file is being read, or
  // couldn't be read).
  isBlocked(name: string): boolean;
}

const readableListeners = new Set<(name: string) => void>();
// Called with a state file's name when a read that had timed out finishes
// after all; the store reading it should load it again (rehydrate).
export function onStateFileReadable(fn: (name: string) => void): () => void {
  readableListeners.add(fn);
  return () => readableListeners.delete(fn);
}

export function createFsStorage(fs: FsAdapter, { readTimeoutMs = READ_TIMEOUT_MS } = {}): FsStorage {
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

  // Whether a write to this file would be dropped (see above).
  const blocked = (name: string) => {
    const status = reads.get(name);
    return status === 'reading' || status === 'failed';
  };

  const write = (name: string, value: string): Promise<void> => {
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
  };

  // Each read gets a number, so a late one only reports for the newest read.
  const attempts = new Map<string, number>();

  return {
    async getItem(name) {
      reads.set(name, 'reading');
      const attempt = (attempts.get(name) ?? 0) + 1;
      attempts.set(name, attempt);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const reading = read(name);
      try {
        const value = await Promise.race([
          reading,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject(new Error(`timed out after ${readTimeoutMs} ms`));
            }, readTimeoutMs);
          }),
        ]);
        reads.set(name, 'ok');
        return value;
      } catch (e) {
        // Not damage: leave the file alone and don't overwrite it.
        reads.set(name, 'failed');
        if (timedOut) {
          // The read may still finish. If it does, the file can be read: the
          // store is told to load it again (still blocked until it does).
          reading
            .then(() => {
              if (attempts.get(name) !== attempt || reads.get(name) !== 'failed') return;
              for (const fn of [...readableListeners]) {
                try {
                  fn(name);
                } catch (err) {
                  console.warn(`Could not reload ${file(name)}`, err);
                }
              }
            })
            .catch(() => undefined);
        }
        console.warn(`Could not read ${file(name)}; starting from defaults and not saving changes to it until the next launch`, e);
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    setItem(name, value) {
      if (blocked(name)) {
        if (reads.get(name) === 'failed' && !reported.has(name)) {
          reported.add(name);
          console.warn(`Not saving ${file(name)}: it could not be read, and saving would replace it with defaults`);
        }
        return Promise.resolve();
      }
      return write(name, value);
    },
    isBlocked: blocked,
    setItemStrict(name, value) {
      if (blocked(name)) return Promise.reject(new StateNotSavedError(file(name)));
      return write(name, value);
    },
    async removeItem(name) {
      if (await fs.stat(path(name))) await fs.remove(path(name));
      if (await fs.stat(tmp(name))) await fs.remove(tmp(name));
    },
  };
}
