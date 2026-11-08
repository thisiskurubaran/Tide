// A project linked to a folder outside the app (Files, iCloud Drive, another
// app's folder). The project is a copy; pull and push sync it both ways,
// using what both sides held after the last sync (the manifest) to tell a
// file deleted on one side from a file new on the other.
import { fromBase64, toBase64 } from '../backup/zip';
import type { Workspace } from '../files/workspace';

// What sync needs from the outside folder. Paths are relative to it.
export interface Folder {
  listFiles(): Promise<string[]>;
  // The file's size in bytes without reading it (null: unknown), so a file
  // too large to sync is never read into memory.
  size?(path: string): Promise<number | null>;
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
  // Paths over MAX_FILE_BYTES on either side: present but not synced. Neither
  // copy is written or deleted because of them.
  tooLarge: string[];
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

// Each side is listed with sizes and hashes only: contents are read again
// one file at a time when written, so neither side's files are all held in
// memory at once.
interface Side {
  files: Map<string, { hash: string }>;
  // Present, but too large to sync.
  tooLarge: Set<string>;
}

interface Source {
  // null: unknown, the file is read and measured.
  size(path: string): Promise<number | null>;
  read(path: string): Promise<Uint8Array>;
}

// Too large files are found from their size, without reading them.
async function snapshotSide(paths: string[], source: Source): Promise<Side> {
  const files = new Map<string, { hash: string }>();
  const tooLarge = new Set<string>();
  for (const path of paths) {
    if (skipped(path)) continue;
    const size = await source.size(path).catch(() => null);
    if (size !== null && size > MAX_FILE_BYTES) {
      tooLarge.add(path);
      continue;
    }
    const bytes = await source.read(path);
    if (bytes.length > MAX_FILE_BYTES) tooLarge.add(path);
    else files.set(path, { hash: hashBytes(bytes) });
  }
  return { files, tooLarge };
}

const projectSource = (workspace: Workspace, project: string): Source => ({
  size: (p) => workspace.fileSize(project, p),
  read: async (p) => fromBase64(await workspace.readBase64(project, p)),
});

const folderSource = (folder: Folder): Source => ({
  size: async (p) => (folder.size ? folder.size(p) : null),
  read: (p) => folder.read(p),
});

const projectSide = async (workspace: Workspace, project: string) => snapshotSide(await workspace.listFiles(project), projectSource(workspace, project));
const folderSide = async (folder: Folder) => snapshotSide(await folder.listFiles(), folderSource(folder));

// Copies `from` onto `to`. Files deleted from `from` since the last sync are
// deleted from `to` too, unless they were changed there meanwhile. A file too
// large on either side is left alone on both: a file that grew past the limit
// is still there, not deleted, and its manifest entry is kept for when it
// shrinks again.
async function syncSides(
  from: Side,
  to: Side,
  manifest: Manifest,
  source: Source,
  write: (path: string, bytes: Uint8Array) => Promise<void>,
  remove: (path: string) => Promise<void>,
): Promise<SyncResult> {
  const tooLarge = new Set([...from.tooLarge, ...to.tooLarge]);
  const result: SyncResult = { manifest: {}, written: 0, removed: 0, overwritten: [], tooLarge: [...tooLarge].sort() };
  for (const path of tooLarge) if (manifest[path]) result.manifest[path] = manifest[path];
  for (const [path, file] of from.files) {
    if (tooLarge.has(path)) continue;
    result.manifest[path] = file.hash;
    const other = to.files.get(path);
    if (other?.hash === file.hash) continue;
    if (other && manifest[path] && other.hash !== manifest[path] && file.hash !== manifest[path]) result.overwritten.push(path);
    // Read again for the write; what's written is what goes in the manifest.
    const bytes = await source.read(path);
    if (bytes.length > MAX_FILE_BYTES) {
      // Grew past the limit since it was listed: left alone, like the others.
      if (manifest[path]) result.manifest[path] = manifest[path];
      else delete result.manifest[path];
      result.tooLarge.push(path);
      continue;
    }
    result.manifest[path] = hashBytes(bytes);
    await write(path, bytes);
    result.written++;
  }
  for (const [path, other] of to.files) {
    if (from.files.has(path) || tooLarge.has(path) || !manifest[path]) continue;
    if (other.hash !== manifest[path]) {
      // Deleted on the other side but changed on this one: keep it, and remember it as this side's.
      result.manifest[path] = other.hash;
      continue;
    }
    await remove(path);
    result.removed++;
  }
  return result;
}

// Folder -> project.
export async function pull(folder: Folder, workspace: Workspace, project: string, manifest: Manifest): Promise<SyncResult> {
  const theirs = await folderSide(folder);
  const ours = await projectSide(workspace, project);
  return syncSides(
    theirs,
    ours,
    manifest,
    folderSource(folder),
    (path, bytes) => workspace.writeBase64(project, path, toBase64(bytes)),
    (path) => workspace.removeIfPresent(project, path),
  );
}

// Project -> folder, the mirror of pull.
export async function push(folder: Folder, workspace: Workspace, project: string, manifest: Manifest): Promise<SyncResult> {
  const ours = await projectSide(workspace, project);
  const theirs = await folderSide(folder);
  return syncSides(ours, theirs, manifest, projectSource(workspace, project), (path, bytes) => folder.write(path, bytes), (path) => folder.remove(path));
}

// One file, after a save: written to the folder and noted in the manifest.
// A file too large on either side is left alone on both, as in a full sync.
export async function pushFile(folder: Folder, workspace: Workspace, project: string, path: string, manifest: Manifest): Promise<Manifest> {
  if (skipped(path)) return manifest;
  if ((await workspace.fileSize(project, path)) > MAX_FILE_BYTES) return manifest;
  const theirs = folder.size ? await folder.size(path).catch(() => null) : null;
  if (theirs !== null && theirs > MAX_FILE_BYTES) return manifest;
  const bytes = fromBase64(await workspace.readBase64(project, path));
  if (bytes.length > MAX_FILE_BYTES) return manifest;
  await folder.write(path, bytes);
  return { ...manifest, [path]: hashBytes(bytes) };
}
