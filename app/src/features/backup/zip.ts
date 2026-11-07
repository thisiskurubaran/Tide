// Projects to and from .zip files, for export, import and snapshots. Uses
// fflate (pure JS), since React Native has no zlib.
import { strToU8, unzipSync, zipSync, Zippable } from 'fflate';

import type { Workspace } from '../files/workspace';

// Above this, a single file is left out of snapshots (exports keep it).
export const SNAPSHOT_FILE_LIMIT = 5 * 1024 * 1024;

export class BackupError extends Error {}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

export function fromBase64(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (LOOKUP[clean.charCodeAt(i)] << 18) | (LOOKUP[clean.charCodeAt(i + 1)] << 12) | (LOOKUP[clean.charCodeAt(i + 2)] << 6) | LOOKUP[clean.charCodeAt(i + 3)];
    out[o++] = n >> 16;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

// A snapshot's own record of what it left out, so a restore never deletes
// files that were too big to keep. Not a project file; restore skips it.
export const SNAPSHOT_MANIFEST = '.tide-snapshot.json';

export interface SnapshotManifest {
  version: 1;
  // Project files left out of the snapshot for being over SNAPSHOT_FILE_LIMIT.
  skipped: string[];
}

// Every project file except node_modules, .git, .pylibs and __pycache__,
// which can be rebuilt (npm install, pip install, git clone). `manifest` adds
// a SNAPSHOT_MANIFEST entry listing the files left out for their size.
export async function zipProject(
  workspace: Workspace,
  project: string,
  { maxFileBytes = Infinity, manifest = false } = {},
): Promise<{ zip: Uint8Array; files: number; skipped: string[] }> {
  const entries: Zippable = {};
  const skipped: string[] = [];
  let files = 0;
  for (const path of await workspace.listFiles(project)) {
    const bytes = fromBase64(await workspace.readBase64(project, path));
    if (bytes.length > maxFileBytes) {
      skipped.push(path);
      continue;
    }
    entries[path] = bytes;
    files++;
  }
  if (manifest) {
    const record: SnapshotManifest = { version: 1, skipped };
    entries[SNAPSHOT_MANIFEST] = strToU8(JSON.stringify(record));
  }
  return { zip: zipSync(entries, { level: 6 }), files, skipped };
}

// The files in a zip, macOS metadata skipped. `stripTopFolder` takes off a
// single top folder shared by every file (GitHub's "repo-main/" downloads);
// it is for imports only, since a snapshot of a project whose files all live
// under one folder must come back with that folder.
export function zipEntries(zip: Uint8Array, { stripTopFolder = false } = {}): { path: string; bytes: Uint8Array }[] {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip);
  } catch {
    throw new BackupError('Not a zip file, or it is damaged');
  }
  const paths = Object.keys(raw).filter((p) => !p.endsWith('/') && !p.startsWith('__MACOSX/') && !p.split('/').includes('.DS_Store'));
  const tops = new Set(paths.map((p) => p.split('/')[0]));
  const strip = stripTopFolder && tops.size === 1 && paths.every((p) => p.includes('/')) ? `${[...tops][0]}/` : '';
  return paths
    .map((p) => ({ path: p.slice(strip.length), bytes: raw[p] }))
    .filter(({ path }) => path && !path.split('/').some((part) => part === '..' || part === '')); // No escaping the project.
}

export async function writeEntries(workspace: Workspace, project: string, entries: { path: string; bytes: Uint8Array }[]) {
  for (const e of entries) await workspace.writeBase64(project, e.path, toBase64(e.bytes));
}
