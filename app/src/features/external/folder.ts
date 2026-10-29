// The Folder that sync works on, over a directory picked in the system's
// folder picker. Android hands out content:// URIs whose children can only be
// reached by listing, so every path is walked one name at a time.
import { Directory, File } from 'expo-file-system';

import type { Folder } from './sync';
import { skipped } from './sync';

const parts = (path: string) => path.split('/').filter(Boolean);

function child(dir: Directory, name: string): Directory | File | undefined {
  return dir.list().find((e) => e.name === name);
}

function walkDirs(root: Directory, names: string[], create: boolean): Directory | null {
  let dir = root;
  for (const name of names) {
    const next = child(dir, name);
    if (next instanceof Directory) dir = next;
    else if (!next && create) dir = dir.createDirectory(name);
    else return null;
  }
  return dir;
}

export function folderAt(uri: string): Folder {
  const root = new Directory(uri);
  const find = (path: string) => {
    const names = parts(path);
    const dir = walkDirs(root, names.slice(0, -1), false);
    return dir ? child(dir, names[names.length - 1]) : undefined;
  };
  return {
    async listFiles() {
      const out: string[] = [];
      const walk = (dir: Directory, prefix: string) => {
        for (const e of dir.list()) {
          const path = prefix + e.name;
          if (skipped(path)) continue;
          if (e instanceof Directory) walk(e, `${path}/`);
          else out.push(path);
        }
      };
      walk(root, '');
      return out;
    },
    async read(path) {
      const f = find(path);
      if (!(f instanceof File)) throw new Error(`"${path}" is no longer in the folder`);
      return f.bytes();
    },
    async write(path, bytes) {
      const names = parts(path);
      const dir = walkDirs(root, names.slice(0, -1), true)!;
      const name = names[names.length - 1];
      const existing = child(dir, name);
      const f = existing instanceof File ? existing : dir.createFile(name, null);
      f.write(bytes);
    },
    async remove(path) {
      find(path)?.delete();
    },
  };
}

// Opens the system folder picker, starting from `initialUri` when re-granting access.
export async function pickFolder(initialUri?: string): Promise<{ uri: string; name: string }> {
  const dir = await Directory.pickDirectoryAsync(initialUri);
  return { uri: dir.uri, name: decodeURIComponent(dir.name || 'Folder') };
}
