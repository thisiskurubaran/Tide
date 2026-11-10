// Local snapshots of a project: zips under Documents/.tide/snapshots/<project>.
// One is taken automatically when a project opens if the last is over an
// hour old, and before a restore, so restoring can be undone too.
import { FsAdapter, joinPath } from '../files/fs';
import type { Workspace } from '../files/workspace';
import { STATE_DIR } from '../../state/storage';
import { strFromU8 } from 'fflate';

import { BackupError, fromBase64, LEGACY_SNAPSHOT_MANIFEST, SNAPSHOT_FILE_LIMIT, SnapshotManifest, snapshotEntries, toBase64, writeEntries, zipProject } from './zip';

export type SnapshotReason = 'auto' | 'manual' | 'before-restore' | 'before-pull';

export interface Snapshot {
  id: string;
  time: number;
  reason: SnapshotReason;
  bytes: number;
}

export const AUTO_INTERVAL_MS = 60 * 60 * 1000;
export const KEEP = 10;

function readManifest(bytes: Uint8Array | undefined): SnapshotManifest | null {
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(strFromU8(bytes));
    return parsed && Array.isArray(parsed.skipped) ? { version: 1, skipped: parsed.skipped.filter((p: unknown) => typeof p === 'string') } : null;
  } catch {
    return null;
  }
}

const dirFor = (project: string) => joinPath(STATE_DIR, 'snapshots', project);

export function createSnapshots(fs: FsAdapter, workspace: Workspace, now: () => number = Date.now) {
  // How many to keep per project (setKeep, for tests).
  let keep = KEEP;
  async function list(project: string): Promise<Snapshot[]> {
    const dir = dirFor(project);
    if ((await fs.stat(dir)) !== 'dir') return [];
    const out: Snapshot[] = [];
    for (const e of await fs.readDir(dir)) {
      const m = /^(\d+)-(auto|manual|before-restore|before-pull)\.zip$/.exec(e.name);
      if (!m || e.kind !== 'file') continue;
      // base64 is 4 characters per 3 bytes.
      const size = Math.floor(((await fs.readBase64(joinPath(dir, e.name))).length * 3) / 4);
      out.push({ id: e.name, time: Number(m[1]), reason: m[2] as SnapshotReason, bytes: size });
    }
    return out.sort((a, b) => b.time - a.time);
  }

  async function take(project: string, reason: SnapshotReason): Promise<Snapshot> {
    // The manifest records what was left out, so restoring leaves those files alone.
    const { zip } = await zipProject(workspace, project, { maxFileBytes: SNAPSHOT_FILE_LIMIT, manifest: true });
    const time = now();
    const id = `${time}-${reason}.zip`;
    await fs.writeBase64(joinPath(dirFor(project), id), toBase64(zip));
    // Keep the newest few.
    const all = await list(project);
    for (const old of all.slice(keep)) await fs.remove(joinPath(dirFor(project), old.id));
    return { id, time, reason, bytes: zip.length };
  }

  return {
    setKeep(n: number) {
      keep = n;
    },
    list,
    take,
    // Takes an automatic snapshot if the newest one is older than the interval.
    async maybeTake(project: string): Promise<Snapshot | null> {
      const [newest] = await list(project);
      if (newest && now() - newest.time < AUTO_INTERVAL_MS) return null;
      return take(project, 'auto');
    },
    // Puts the project back as it was. node_modules, .git and the like are
    // left alone; they weren't in the snapshot. Neither are files too big for
    // snapshots: they were never captured, so deleting them would lose them.
    async restore(project: string, id: string): Promise<void> {
      const path = joinPath(dirFor(project), id);
      if ((await fs.stat(path)) !== 'file') throw new BackupError('That snapshot is gone');
      const { entries, manifest, legacy } = snapshotEntries(fromBase64(await fs.readBase64(path)));
      const skipped = new Set(readManifest(manifest ?? undefined)?.skipped ?? []);
      // An older snapshot couldn't hold a project file of the manifest's name,
      // so one there now wasn't captured: it's left alone.
      if (legacy) skipped.add(LEGACY_SNAPSHOT_MANIFEST);
      await take(project, 'before-restore');
      const keep = new Set(entries.map((e) => e.path));
      for (const file of await workspace.listFiles(project)) {
        if (keep.has(file) || skipped.has(file)) continue;
        // Older snapshots have no manifest; a big file may have been left out.
        if ((await workspace.fileSize(project, file).catch(() => Infinity)) > SNAPSHOT_FILE_LIMIT) continue;
        await workspace.removeIfPresent(project, file);
      }
      await writeEntries(workspace, project, entries);
    },
    async remove(project: string, id: string) {
      await fs.remove(joinPath(dirFor(project), id));
    },
    async renameProject(from: string, to: string) {
      if ((await fs.stat(dirFor(from))) === 'dir') await fs.rename(dirFor(from), to);
    },
    async removeProject(project: string) {
      if ((await fs.stat(dirFor(project))) === 'dir') await fs.remove(dirFor(project));
    },
  };
}

export type Snapshots = ReturnType<typeof createSnapshots>;
