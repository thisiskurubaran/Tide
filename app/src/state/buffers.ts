import { strToU8 } from 'fflate';
import { createStore } from 'zustand';

import { toBase64 } from '../features/backup/zip';

import type { Workspace } from '../features/files/workspace';

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
}

export interface BuffersHooks {
  // A buffer with no unsaved edits went away because its file was deleted on
  // disk; its tab should close the way it does for a delete in the file tree.
  gone?(project: string, path: string): void;
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

// Open-file contents and autosave. Buffers outlive tab switches so switching
// back is instant and unsaved text is never dropped.
export function createBuffersStore(workspace: Workspace, autosaveMs = AUTOSAVE_MS, hooks: BuffersHooks = {}, now: () => number = Date.now) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Buffers drop() forgot recently: what was on disk, and when.
  const dropped = new Map<string, { saved: string; at: number }>();
  const forgetDropped = (match: (project: string, path: string) => boolean) => {
    for (const key of [...dropped.keys()]) if (match(...splitKey(key))) dropped.delete(key);
  };

  const cancel = (key: string) => {
    const t = timers.get(key);
    if (t !== undefined) clearTimeout(t);
    timers.delete(key);
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
      // writeFile only writes over an existing file; writeBase64 creates it (and its folders).
      if (buffer.deleted) await workspace.writeBase64(project, path, toBase64(strToU8(content)));
      else await workspace.writeFile(project, path, content);
      set((s) => {
        const current = s.buffers[key];
        // The user may have kept typing while the write was in flight.
        return current ? { buffers: { ...s.buffers, [key]: { content: current.content, saved: content } } } : s;
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

    const rekey = (match: (project: string, path: string) => [string, string] | null | undefined) =>
      set((s) => {
        const buffers: Record<string, Buffer> = {};
        for (const [key, buffer] of Object.entries(s.buffers)) {
          const [project, path] = splitKey(key);
          const next = match(project, path);
          if (next === null) {
            cancel(key);
            continue;
          }
          buffers[next ? bufferKey(...next) : key] = buffer;
        }
        return { buffers };
      });

    return {
      buffers: {},
      async load(project, path) {
        const key = bufferKey(project, path);
        const existing = get().buffers[key];
        if (existing) {
          // Something other than the editor may have changed the file since
          // (a program, git); a buffer with no unsaved edits follows the disk.
          if (!isDirty(existing)) await get().reload(project, path);
          const current = get().buffers[key];
          if (current) return current;
          // The file was deleted on disk; read it again for the real error (or
          // the new file, if it came back in the meantime).
        }
        const content = await workspace.readFile(project, path);
        dropped.delete(key);
        const buffer = { content, saved: content };
        set((s) => ({ buffers: { ...s.buffers, [key]: s.buffers[key] ?? buffer } }));
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
        await workspace.writeFile(project, path, content);
        set((s) => (s.buffers[key] ? { buffers: { ...s.buffers, [key]: { content, saved: content } } } : s));
      },
      async reload(project, path) {
        const key = bufferKey(project, path);
        const buffer = get().buffers[key];
        if (!buffer) return;
        // Missing, as opposed to unreadable for a moment: only a missing file counts as deleted.
        const kind = await workspace.stat(project, path).catch(() => undefined);
        if (kind === undefined) return;
        if (kind !== 'file') return gone(project, path);
        if (isDirty(buffer) && !buffer.deleted) return;
        const content = await workspace.readFile(project, path).catch(() => null);
        if (content === null) return;
        set((s) => {
          const current = s.buffers[key];
          if (!current) return s;
          // Back on disk (e.g. git checkout the other way): unsaved edits stay unsaved.
          if (current.deleted) return { buffers: { ...s.buffers, [key]: { content: current.content, saved: content } } };
          if (isDirty(current) || current.content === content) return s;
          return { buffers: { ...s.buffers, [key]: { content, saved: content } } };
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
