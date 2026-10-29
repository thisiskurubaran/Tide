// Paths are POSIX-style and relative to the adapter's root (the app's
// Documents directory on device), e.g. "projects/hello/index.js".
export type EntryKind = 'file' | 'dir';

export interface DirEntry {
  name: string;
  kind: EntryKind;
}

export interface FsAdapter {
  stat(path: string): Promise<EntryKind | null>;
  readDir(path: string): Promise<DirEntry[]>;
  // Creates missing parents, like mkdir -p.
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  // In bytes, so huge files can be turned away before reading them.
  size(path: string): Promise<number>;
  // Creates missing parents.
  writeFile(path: string, content: string): Promise<void>;
  // Renames within the same parent directory.
  rename(path: string, newName: string): Promise<void>;
  // Recursive for directories.
  remove(path: string): Promise<void>;
  // Raw bytes as base64, for syncing files that may not be text.
  readBase64(path: string): Promise<string>;
  // Creates missing parents.
  writeBase64(path: string, data: string): Promise<void>;
  // Byte-for-byte file copy; creates missing parents and overwrites `to`.
  copyFile(from: string, to: string): Promise<void>;
}

export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
