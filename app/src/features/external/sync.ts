// A project linked to a folder outside the app (Files, iCloud Drive, another
// app's folder). The project is a copy; pull and push sync it both ways,
// using what both sides held after the last sync (the manifest) to tell a
// file deleted on one side from a file new on the other.
import { fromBase64, toBase64 } from '../backup/zip';
import type { Workspace } from '../files/workspace';

// What sync needs from the outside folder. Paths are relative to it.
export interface Folder {
  listFiles(): Promise<string[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

// path -> content hash, as of the last sync.
export type Manifest = Record<string, string>;

export interface SyncResult {
  manifest: Manifest;
  written: number;
  removed: number;
  // Paths changed on both sides since the last sync; the side being synced from won.
  overwritten: string[];
}

// Folders that are rebuilt rather than synced, as for snapshots.
const SKIP = new Set(['node_modules', '.git', '.pylibs', '__pycache__', '.DS_Store']);
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const skipped = (path: string) => path.split('/').some((part) => SKIP.has(part));

// FNV-1a over the bytes: enough to notice a change, and cheap on a phone.
export function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${bytes.length}:${(h >>> 0).toString(36)}`;
}

async function snapshotSide(paths: string[], read: (p: string) => Promise<Uint8Array>) {
  const files = new Map<string, { bytes: Uint8Array; hash: string }>();
  for (const path of paths) {
    if (skipped(path)) continue;
    const bytes = await read(path);
    if (bytes.length > MAX_FILE_BYTES) continue;
    files.set(path, { bytes, hash: hashBytes(bytes) });
  }
  return files;
}

const projectSide = (workspace: Workspace, project: string) =>
  workspace.listFiles(project).then((paths) => snapshotSide(paths, async (p) => fromBase64(await workspace.readBase64(project, p))));

// Folder -> project. Files deleted from the folder since the last sync are
// deleted here too, unless they were changed here meanwhile.
export async function pull(folder: Folder, workspace: Workspace, project: string, manifest: Manifest): Promise<SyncResult> {
  const theirs = await snapshotSide(await folder.listFiles(), (p) => folder.read(p));
  const ours = await projectSide(workspace, project);
  const result: SyncResult = { manifest: {}, written: 0, removed: 0, overwritten: [] };
  for (const [path, file] of theirs) {
    result.manifest[path] = file.hash;
    const mine = ours.get(path);
    if (mine?.hash === file.hash) continue;
    if (mine && manifest[path] && mine.hash !== manifest[path] && file.hash !== manifest[path]) result.overwritten.push(path);
    await workspace.writeBase64(project, path, toBase64(file.bytes));
    result.written++;
  }
  for (const [path, mine] of ours) {
    if (theirs.has(path) || !manifest[path]) continue;
    if (mine.hash !== manifest[path]) {
      // Deleted there but changed here: keep it, and remember it as ours.
      result.manifest[path] = mine.hash;
      continue;
    }
    await workspace.removeIfPresent(project, path);
    result.removed++;
  }
  return result;
}

// Project -> folder, the mirror of pull.
export async function push(folder: Folder, workspace: Workspace, project: string, manifest: Manifest): Promise<SyncResult> {
  const ours = await projectSide(workspace, project);
  const theirs = await snapshotSide(await folder.listFiles(), (p) => folder.read(p));
  const result: SyncResult = { manifest: {}, written: 0, removed: 0, overwritten: [] };
  for (const [path, file] of ours) {
    result.manifest[path] = file.hash;
    const other = theirs.get(path);
    if (other?.hash === file.hash) continue;
    if (other && manifest[path] && other.hash !== manifest[path] && file.hash !== manifest[path]) result.overwritten.push(path);
    await folder.write(path, file.bytes);
    result.written++;
  }
  for (const [path, other] of theirs) {
    if (ours.has(path) || !manifest[path]) continue;
    if (other.hash !== manifest[path]) {
      result.manifest[path] = other.hash;
      continue;
    }
    await folder.remove(path);
    result.removed++;
  }
  return result;
}

// One file, after a save: written to the folder and noted in the manifest.
export async function pushFile(folder: Folder, workspace: Workspace, project: string, path: string, manifest: Manifest): Promise<Manifest> {
  if (skipped(path)) return manifest;
  const bytes = fromBase64(await workspace.readBase64(project, path));
  if (bytes.length > MAX_FILE_BYTES) return manifest;
  await folder.write(path, bytes);
  return { ...manifest, [path]: hashBytes(bytes) };
}
