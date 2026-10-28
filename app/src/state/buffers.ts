import { createStore } from 'zustand';

import type { Workspace } from '../features/files/workspace';

export const AUTOSAVE_MS = 800;

export interface Buffer {
  content: string;
  // What is on disk, as far as we know. dirty = content !== saved.
  saved: string;
}

export interface BuffersState {
  buffers: Record<string, Buffer>;
  load(project: string, path: string): Promise<Buffer>;
  edit(project: string, path: string, content: string): void;
  save(project: string, path: string): Promise<void>;
  // Writes `content` to disk and makes it the buffer's text, dropping unsaved edits.
  // Used when something other than the editor (the shell) changes a file.
  replace(project: string, path: string, content: string): Promise<void>;
  // Rereads a file that changed on disk behind the editor's back. Unsaved edits win.
  reload(project: string, path: string): Promise<void>;
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
export function createBuffersStore(workspace: Workspace, autosaveMs = AUTOSAVE_MS) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancel = (key: string) => {
    const t = timers.get(key);
    if (t !== undefined) clearTimeout(t);
    timers.delete(key);
  };

  return createStore<BuffersState>()((set, get) => {
    const write = async (key: string) => {
      cancel(key);
      const buffer = get().buffers[key];
      if (!isDirty(buffer)) return;
      const [project, path] = splitKey(key);
      const content = buffer.content;
      await workspace.writeFile(project, path, content);
      set((s) => {
        const current = s.buffers[key];
        // The user may have kept typing while the write was in flight.
        return current ? { buffers: { ...s.buffers, [key]: { ...current, saved: content } } } : s;
      });
    };

    const flushWhere = (match: (project: string, path: string) => boolean) =>
      Promise.all(
        Object.keys(get().buffers)
          .filter((k) => match(...splitKey(k)))
          .map(write),
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
        if (existing) return existing;
        const content = await workspace.readFile(project, path);
        const buffer = { content, saved: content };
        set((s) => ({ buffers: { ...s.buffers, [key]: s.buffers[key] ?? buffer } }));
        return get().buffers[key];
      },
      edit(project, path, content) {
        const key = bufferKey(project, path);
        const buffer = get().buffers[key];
        if (!buffer || buffer.content === content) return;
        set((s) => ({ buffers: { ...s.buffers, [key]: { ...buffer, content } } }));
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
      save: (project, path) => write(bufferKey(project, path)),
      async replace(project, path, content) {
        const key = bufferKey(project, path);
        cancel(key);
        await workspace.writeFile(project, path, content);
        set((s) => (s.buffers[key] ? { buffers: { ...s.buffers, [key]: { content, saved: content } } } : s));
      },
      async reload(project, path) {
        const key = bufferKey(project, path);
        const buffer = get().buffers[key];
        if (!buffer || isDirty(buffer)) return;
        const content = await workspace.readFile(project, path).catch(() => null);
        if (content === null) return;
        set((s) => {
          const current = s.buffers[key];
          if (!current || isDirty(current)) return s;
          return { buffers: { ...s.buffers, [key]: { content, saved: content } } };
        });
      },
      flushAll: () => flushWhere(() => true),
      flushProject: (project) => flushWhere((p) => p === project),
      renamePath: (project, from, to) =>
        rekey((p, path) => (p === project && isUnder(path, from) ? [p, to + path.slice(from.length)] : undefined)),
      removePath: (project, path) => rekey((p, q) => (p === project && isUnder(q, path) ? null : undefined)),
      renameProject: (from, to) => rekey((p, path) => (p === from ? [to, path] : undefined)),
      removeProject: (project) => rekey((p) => (p === project ? null : undefined)),
    };
  });
}
