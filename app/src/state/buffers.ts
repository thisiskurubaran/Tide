import { strToU8 } from 'fflate';
import { createStore } from 'zustand';

import { toBase64 } from '../features/backup/zip';
import { basename, dirname, joinPath } from '../features/files/fs';
import { WorkspaceError, type Workspace } from '../features/files/workspace';

export const AUTOSAVE_MS = 800;
// How long after drop() a late edit from the editor (its change messages are
// debounced) still brings the buffer back and gets saved, instead of being lost.
export const DROP_GRACE_MS = 3000;

export interface Buffer {
  content: string;
  // What is on disk, as far as we know. dirty = content !== saved.
  saved: string;
  // The file was deleted on disk (git checkout, a snapshot restore, rm) while
  // this buffer had unsaved edits. The edits are kept, but nothing writes the
  // file back except save() with `recreate`.
  deleted?: boolean;
  // Unsaved edits that couldn't stay in this buffer were written to this file
  // instead: the deleted file came back with other content, or another
  // buffer was moved onto this path. Shown until dismissed.
  recoveredTo?: string;
}

export interface BuffersHooks {
  // A buffer with no unsaved edits went away because its file was deleted on
  // disk; its tab should close the way it does for a delete in the file tree.
  gone?(project: string, path: string): void;
  // Runs before a buffer is treated as gone, so typing the editors still hold
  // back (their change messages are debounced) reaches it first and keeps it.
  beforeGone?(): Promise<void>;
  // Unsaved edits were written to `recoveredPath` (see Buffer.recoveredTo).
  recovered?(project: string, path: string, recoveredPath: string): void;
}

export interface BuffersState {
  buffers: Record<string, Buffer>;
  load(project: string, path: string): Promise<Buffer>;
  // Edits to a buffer that isn't loaded are ignored, except shortly after
  // drop(): the editor may still send the last keystrokes of a closed tab.
  edit(project: string, path: string, content: string): void;
  // Writes unsaved edits. A buffer whose file was deleted on disk is only
  // written with `recreate`, i.e. when the user asks for it.
  save(project: string, path: string, options?: { recreate?: boolean }): Promise<void>;
  // Writes `content` to disk and makes it the buffer's text, dropping unsaved edits.
  // Used when something other than the editor (the shell) changes a file.
  replace(project: string, path: string, content: string): Promise<void>;
  // Rereads a file that changed on disk behind the editor's back. Unsaved edits win.
  // If the file is gone, a buffer without unsaved edits goes too (hooks.gone);
  // one with unsaved edits is kept and marked `deleted`.
  reload(project: string, path: string): Promise<void>;
  // reload() for every buffer of a project, after a program, git, a package
  // install or a snapshot restore changed files on disk. Unsaved edits win.
  reloadProject(project: string): Promise<void>;
  // Forgets a buffer with no unsaved edits, e.g. when its tab closes, so the
  // next open reads the file fresh. Dirty buffers are kept.
  drop(project: string, path: string): void;
  // Forgets a buffer even with unsaved edits, when the user chose to discard them.
  discard(project: string, path: string): void;
  // While held (a rename or move in progress), a missing file at or under
  // `path` isn't treated as deleted. Returns the release.
  hold(project: string, path: string): () => void;
  clearRecovered(project: string, path: string): void;
  // Saves everything pending, e.g. before the app goes to the background.
  flushAll(): Promise<void>;
  flushProject(project: string): Promise<void>;
  renamePath(project: string, from: string, to: string): void;
  removePath(project: string, path: string): void;
  renameProject(from: string, to: string): void;
  removeProject(project: string): void;
}

const SEP = '\u0000';
export const bufferKey = (project: string, path: string) => `${project}${SEP}${path}`;
export const splitKey = (key: string) => key.split(SEP) as [string, string];
const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export const isDirty = (b: Buffer | undefined) => b !== undefined && b.content !== b.saved;

const isNotFound = (e: unknown) =>
  (e instanceof WorkspaceError && e.code === 'not-found') || /ENOENT|not found|doesn't exist|does not exist/i.test(String((e as Error)?.message ?? e));

// Next to `path`: app.recovered.js, then app.recovered-2.js and so on.
const recoveredCandidate = (path: string, n: number) => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return joinPath(dirname(path), `${stem}.recovered${n === 1 ? '' : `-${n}`}${ext}`);
};

// Open-file contents and autosave. Buffers outlive tab switches so switching
// back is instant and unsaved text is never dropped.
export function createBuffersStore(workspace: Workspace, autosaveMs = AUTOSAVE_MS, hooks: BuffersHooks = {}, now: () => number = Date.now) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Buffers drop() forgot recently: what was on disk, and when.
  const dropped = new Map<string, { saved: string; at: number }>();
  const forgetDropped = (match: (project: string, path: string) => boolean) => {
    for (const key of [...dropped.keys()]) if (match(...splitKey(key))) dropped.delete(key);
  };

  // Bumped whenever a buffer's text or saved text is written or replaced
  // (before and after the write lands). A reload whose read started before the
  // latest bump may have read an older file and is discarded, so a slow reload
  // can't put back old text, and mark it saved, over a newer save or replace.
  const versions = new Map<string, number>();
  const bump = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);
  const version = (key: string) => versions.get(key) ?? 0;

  const cancel = (key: string) => {
    const t = timers.get(key);
    if (t !== undefined) clearTimeout(t);
    timers.delete(key);
  };

  // The file's size and modification time when its text was last read into
  // the buffer, so loading an unchanged file again (a tab switch) skips the read.
  const stamps = new Map<string, string>();
  const stampOf = (project: string, path: string) => workspace.fileStamp(project, path).catch(() => null);

  // Paths being renamed or moved (see hold()), with how many holds each has.
  const held = new Map<string, number>();
  const isHeld = (project: string, path: string) =>
    [...held.keys()].some((k) => {
      const [p, q] = splitKey(k);
      return p === project && isUnder(path, q);
    });

  // Writes edits that have nowhere else to go to a new file next to `path`.
  const recover = async (project: string, path: string, content: string) => {
    for (let n = 1; n < 100; n++) {
      const candidate = recoveredCandidate(path, n);
      if ((await workspace.stat(project, candidate)) !== null) continue;
      await workspace.writeBase64(project, candidate, toBase64(strToU8(content)));
      hooks.recovered?.(project, path, candidate);
      return candidate;
    }
    throw new Error(`No free name to recover ${path} to`);
  };

  return createStore<BuffersState>()((set, get) => {
    const write = async (key: string, recreate = false) => {
      cancel(key);
      const buffer = get().buffers[key];
      if (!buffer || (!isDirty(buffer) && !(recreate && buffer.deleted))) return;
      // Autosave and flushes never bring back a file deleted on disk.
      if (buffer.deleted && !recreate) return;
      const [project, path] = splitKey(key);
      const content = buffer.content;
      bump(key);
      stamps.delete(key);
      try {
        // writeFile only writes over an existing file; writeBase64 creates it (and its folders).
        if (buffer.deleted) await workspace.writeBase64(project, path, toBase64(strToU8(content)));
        else await workspace.writeFile(project, path, content);
      } catch (e) {
        bump(key);
        if (buffer.deleted || !isNotFound(e)) throw e;
        // Removed behind the editor's back (remote sync, rm): the edits are
        // kept and marked, like a delete reload() notices, and nothing else
        // (rename, Run, closing) waits on this file any more.
        set((s) => {
          const current = s.buffers[key];
          return current && isDirty(current) && !current.deleted ? { buffers: { ...s.buffers, [key]: { ...current, deleted: true } } } : s;
        });
        return;
      }
      bump(key);
      set((s) => {
        const current = s.buffers[key];
        // The user may have kept typing while the write was in flight.
        return current ? { buffers: { ...s.buffers, [key]: { content: current.content, saved: content, ...(current.recoveredTo ? { recoveredTo: current.recoveredTo } : {}) } } } : s;
      });
    };

    // The file is gone from disk: forget a clean buffer, keep unsaved edits.
    const gone = (project: string, path: string) => {
      const key = bufferKey(project, path);
      let removed = false;
      set((s) => {
        const current = s.buffers[key];
        if (!current) return s;
        if (isDirty(current)) return current.deleted ? s : { buffers: { ...s.buffers, [key]: { ...current, deleted: true } } };
        cancel(key);
        removed = true;
        const { [key]: _gone, ...rest } = s.buffers;
        return { buffers: rest };
      });
      if (removed) hooks.gone?.(project, path);
    };

    const flushWhere = (match: (project: string, path: string) => boolean) =>
      Promise.all(
        Object.keys(get().buffers)
          .filter((k) => match(...splitKey(k)))
          .map((key) => write(key)),
      ).then(() => undefined);

    const rekey = (match: (project: string, path: string) => [string, string] | null | undefined) => {
      // Unsaved edits of buffers a moved buffer lands on, to keep elsewhere.
      const orphans: [string, string, string][] = [];
      set((s) => {
        const plan = Object.entries(s.buffers).map(([key, buffer]) => [key, buffer, match(...splitKey(key))] as const);
        const buffers: Record<string, Buffer> = {};
        // Buffers that stay put first, so a moved one landing on one sees it.
        for (const [key, buffer, next] of plan) if (next === undefined) buffers[key] = buffer;
        for (const [key, buffer, next] of plan) {
          if (next === undefined) continue;
          stamps.delete(key);
          if (next === null) {
            cancel(key);
            continue;
          }
          const to = bufferKey(...next);
          // An in-flight reload of whatever was at the new path is stale now.
          bump(to);
          bump(key);
          stamps.delete(to);
          // A buffer already at the new path (e.g. a file deleted on disk with
          // unsaved edits) isn't written over: its edits go to a recovered file.
          const occupant = buffers[to];
          if (occupant && isDirty(occupant)) orphans.push([next[0], next[1], occupant.content]);
          buffers[to] = buffer;
        }
        return { buffers };
      });
      for (const [project, path, content] of orphans) recover(project, path, content).catch((e) => console.warn('Could not recover unsaved edits', e));
    };

    return {
      buffers: {},
      async load(project, path) {
        const key = bufferKey(project, path);
        const existing = get().buffers[key];
        if (existing) {
          // Something other than the editor may have changed the file since
          // (a program, git); a buffer with no unsaved edits follows the disk.
          // A buffer whose file was deleted checks whether it came back.
          if (existing.deleted) await get().reload(project, path);
          else if (!isDirty(existing)) {
            // Unchanged since it was read (same size and time): no need to read it again.
            const known = stamps.get(key);
            const unchanged = known !== undefined && (await stampOf(project, path)) === known;
            if (!unchanged) await get().reload(project, path);
          }
          const current = get().buffers[key];
          if (current) return current;
          // The file was deleted on disk; read it again for the real error (or
          // the new file, if it came back in the meantime).
        }
        // Before the read: a change between the two then means a reread, never a missed change.
        const stamp = await stampOf(project, path);
        const content = await workspace.readFile(project, path);
        dropped.delete(key);
        const buffer = { content, saved: content };
        set((s) => ({ buffers: { ...s.buffers, [key]: s.buffers[key] ?? buffer } }));
        if (stamp !== null && get().buffers[key] === buffer) stamps.set(key, stamp);
        return get().buffers[key];
      },
      edit(project, path, content) {
        const key = bufferKey(project, path);
        let buffer = get().buffers[key];
        if (!buffer) {
          // The last keystrokes of a tab that just closed: bring the buffer
          // back so they get saved.
          const recent = dropped.get(key);
          dropped.delete(key);
          if (!recent || now() - recent.at > DROP_GRACE_MS) return;
          buffer = { content: recent.saved, saved: recent.saved };
        }
        if (buffer.content === content) return;
        const next = buffer;
        set((s) => ({ buffers: { ...s.buffers, [key]: { ...next, content } } }));
        cancel(key);
        if (isDirty(get().buffers[key])) {
          timers.set(
            key,
            setTimeout(() => {
              write(key).catch(() => undefined);
            }, autosaveMs),
          );
        }
      },
      save: (project, path, options) => write(bufferKey(project, path), options?.recreate === true),
      async replace(project, path, content) {
        const key = bufferKey(project, path);
        cancel(key);
        bump(key);
        await workspace.writeFile(project, path, content);
        bump(key);
        set((s) => (s.buffers[key] ? { buffers: { ...s.buffers, [key]: { content, saved: content } } } : s));
      },
      async reload(project, path) {
        const key = bufferKey(project, path);
        const buffer = get().buffers[key];
        if (!buffer) return;
        const started = version(key);
        // Missing, as opposed to unreadable for a moment: only a missing file counts as deleted.
        const kind = await workspace.stat(project, path).catch(() => undefined);
        if (kind === undefined || version(key) !== started) return;
        if (kind !== 'file') {
          // Mid-rename: the file is only between names.
          if (isHeld(project, path)) return;
          if (!buffer.deleted && hooks.beforeGone) {
            await hooks.beforeGone().catch(() => undefined);
            if (version(key) !== started || isHeld(project, path)) return;
          }
          return gone(project, path);
        }
        if (isDirty(buffer) && !buffer.deleted) return;
        const stamp = await stampOf(project, path);
        const content = await workspace.readFile(project, path).catch(() => null);
        if (content === null) return;
        const deleted = get().buffers[key];
        if (deleted?.deleted && version(key) === started && content !== deleted.saved && content !== deleted.content) {
          // A different file now has this path (a new file, a sync): it isn't
          // written over. It shows as it is on disk, and the unsaved edits are
          // written to a recovered copy first, so nothing is lost.
          const edits = deleted.content;
          const to = await recover(project, path, edits).catch((e) => {
            console.warn('Could not recover unsaved edits', e);
            return null;
          });
          if (to === null) return;
          set((s) => {
            const current = s.buffers[key];
            // Typed into (or renamed) meanwhile: stays as it is; the next reload recovers again.
            if (!current || current.content !== edits || version(key) !== started) return s;
            bump(key);
            return { buffers: { ...s.buffers, [key]: { content, saved: content, recoveredTo: to } } };
          });
          return;
        }
        set((s) => {
          const current = s.buffers[key];
          // Written, replaced or reloaded since this read started: the read may be older.
          if (!current || version(key) !== started) return s;
          // Back on disk as it was (e.g. git checkout the other way): unsaved edits stay unsaved.
          if (current.deleted) {
            bump(key);
            return { buffers: { ...s.buffers, [key]: { content: current.content, saved: content } } };
          }
          if (isDirty(current)) return s;
          if (stamp !== null) stamps.set(key, stamp);
          if (current.content === content) return s;
          bump(key);
          return { buffers: { ...s.buffers, [key]: { ...current, content, saved: content } } };
        });
      },
      async reloadProject(project) {
        const paths = Object.keys(get().buffers)
          .map(splitKey)
          .filter(([p]) => p === project)
          .map(([, path]) => path);
        await Promise.all(paths.map((path) => get().reload(project, path)));
      },
      drop(project, path) {
        const key = bufferKey(project, path);
        const buffer = get().buffers[key];
        if (!buffer || isDirty(buffer)) return;
        cancel(key);
        if (!buffer.deleted) dropped.set(key, { saved: buffer.saved, at: now() });
        set((s) => {
          const { [key]: _dropped, ...rest } = s.buffers;
          return { buffers: rest };
        });
      },
      discard(project, path) {
        const key = bufferKey(project, path);
        cancel(key);
        dropped.delete(key);
        stamps.delete(key);
        bump(key);
        set((s) => {
          if (!s.buffers[key]) return s;
          const { [key]: _discarded, ...rest } = s.buffers;
          return { buffers: rest };
        });
      },
      hold(project, path) {
        const key = bufferKey(project, path);
        held.set(key, (held.get(key) ?? 0) + 1);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const n = (held.get(key) ?? 1) - 1;
          if (n > 0) held.set(key, n);
          else held.delete(key);
        };
      },
      clearRecovered(project, path) {
        const key = bufferKey(project, path);
        set((s) => {
          const current = s.buffers[key];
          if (!current?.recoveredTo) return s;
          const { recoveredTo: _shown, ...rest } = current;
          return { buffers: { ...s.buffers, [key]: rest } };
        });
      },
      flushAll: () => flushWhere(() => true),
      flushProject: (project) => flushWhere((p) => p === project),
      // A late edit must not bring back a file that was moved or deleted.
      renamePath: (project, from, to) => {
        forgetDropped((p, path) => p === project && isUnder(path, from));
        rekey((p, path) => (p === project && isUnder(path, from) ? [p, to + path.slice(from.length)] : undefined));
      },
      removePath: (project, path) => {
        forgetDropped((p, q) => p === project && isUnder(q, path));
        rekey((p, q) => (p === project && isUnder(q, path) ? null : undefined));
      },
      renameProject: (from, to) => {
        forgetDropped((p) => p === from);
        rekey((p, path) => (p === from ? [to, path] : undefined));
      },
      removeProject: (project) => {
        forgetDropped((p) => p === project);
        rekey((p) => (p === project ? null : undefined));
      },
    };
  });
}
