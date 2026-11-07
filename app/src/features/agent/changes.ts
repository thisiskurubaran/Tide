// The agent's pending changes: every edit it makes is staged here, per project
// and per file, and only reaches the project when the user keeps it.
//
// Each change has three versions of the file:
//   original  the accepted baseline (null = the file didn't exist). Starts as
//             the file the agent found; kept hunks move into it.
//   proposed  the agent's version. Rejected hunks are taken out of it.
//   base      the file as the agent found it (for local history).
//   disk      what is on disk right now, as far as we know (null = absent).
//             It equals `original` until a command runs: run_command writes
//             every pending change to disk first so programs see them
//             ("applied, not yet reviewed"); then it equals `proposed`.
// A change is resolved once original === proposed; the disk then gets the
// final text (or the file is removed, for a rejected new file).
//
// Pending changes are saved to app state (.tide/agent-changes.json), so if the
// app is killed after run_command applied them to disk, the originals survive
// and Review, Keep, Reject and Undo still work after a relaunch.
import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { applyHunk, diffText, Hunk, revertHunk } from '../../extensions/gitPro/diff';

export interface FileChange {
  path: string;
  original: string | null;
  proposed: string;
  disk: string | null;
  // The file as the agent found it, for local history.
  base: string | null;
}

// Reads and writes the real project files. `read` returns null when the file
// doesn't exist; `write` with null removes it, and creates folders as needed.
export interface ChangeIo {
  read(project: string, path: string): Promise<string | null>;
  write(project: string, path: string, content: string | null): Promise<void>;
  // Local history, when a kept change replaces a file's text.
  recordHistory?(project: string, path: string, content: string, before: string | null): Promise<void> | void;
}

// The file changed outside the agent since it was staged (the user edited it,
// or a program wrote it). Keep or reject again with `force` to overwrite.
export class ChangeConflictError extends Error {
  constructor(readonly path: string) {
    super(`${path} changed since the agent edited it.`);
  }
}

export interface ChangesState {
  byProject: Record<string, Record<string, FileChange>>;
  // Stages the agent's new text for a file. `current` is the file's text before
  // this edit (null = it doesn't exist); ignored when the file already has a change.
  stage(project: string, path: string, current: string | null, proposed: string): FileChange | null;
  keepHunk(project: string, path: string, index: number, force?: boolean): Promise<void>;
  rejectHunk(project: string, path: string, index: number, force?: boolean): Promise<void>;
  keepFile(project: string, path: string, force?: boolean): Promise<void>;
  rejectFile(project: string, path: string, force?: boolean): Promise<void>;
  keepAll(project: string, force?: boolean): Promise<void>;
  undoAll(project: string, force?: boolean): Promise<void>;
  // run_command: writes every pending change to disk so programs see it.
  applyToDisk(project: string): Promise<void>;
  // After a command: picks up what programs wrote to files with applied changes.
  syncFromDisk(project: string): Promise<void>;
  // Drops everything without touching disk (project deleted).
  forget(project: string): void;
}

const EMPTY: Record<string, FileChange> = {};

export function changeHunks(change: FileChange): Hunk[] {
  return diffText(change.original ?? '', change.proposed, 3) ?? [wholeFileHunk(change.original ?? '', change.proposed)];
}

// Huge files don't get a line diff; they are one hunk replacing everything.
function wholeFileHunk(before: string, after: string): Hunk {
  const a = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const b = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return {
    oldStart: a.length ? 1 : 0,
    oldLines: a.length,
    newStart: b.length ? 1 : 0,
    newLines: b.length,
    lines: [...a.map((text, i) => ({ kind: 'del' as const, text, oldLine: i + 1 })), ...b.map((text, i) => ({ kind: 'add' as const, text, newLine: i + 1 }))],
  };
}

export function countLines(hunks: Hunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const h of hunks) for (const l of h.lines) l.kind === 'add' ? added++ : l.kind === 'del' ? removed++ : undefined;
  return { added, removed };
}

// +N / −N between two texts, for step rows.
export function diffStats(before: string | null, after: string | null): { added: number; removed: number } {
  return countLines(diffText(before ?? '', after ?? '', 0) ?? [wholeFileHunk(before ?? '', after ?? '')]);
}

export const CHANGES_STORAGE_KEY = 'agent-changes';
const CHANGES_VERSION = 1;

type Persisted = Pick<ChangesState, 'byProject'>;

// Nothing saved: for tests. Hydrates synchronously.
const noStorage: StateStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

// Saved changes load under any staged before loading finished (those are newer).
function mergeSaved(saved: unknown, current: ChangesState): ChangesState {
  const byProject = { ...current.byProject };
  const stored = (saved as Persisted | undefined)?.byProject;
  if (stored && typeof stored === 'object') {
    for (const [project, files] of Object.entries(stored)) byProject[project] = { ...files, ...current.byProject[project] };
  }
  return { ...current, byProject };
}

// `storage` keeps pending changes across launches (see the top of this file).
export function createChangesStore(io: ChangeIo, storage: StateStorage = noStorage) {
  // persist's own writes aren't awaited; this one is, so pending changes are
  // on record before run_command puts them on disk.
  const saveNow = (state: Persisted) =>
    Promise.resolve(storage.setItem(CHANGES_STORAGE_KEY, JSON.stringify({ state: { byProject: state.byProject }, version: CHANGES_VERSION })));

  return createStore<ChangesState>()(
    persist(
      (set, get) => {
        const files = (project: string) => get().byProject[project] ?? EMPTY;

        const put = (project: string, change: FileChange | null, path: string) =>
          set((s) => {
            const next = { ...(s.byProject[project] ?? EMPTY) };
            if (change) next[path] = change;
            else delete next[path];
            return { byProject: { ...s.byProject, [project]: next } };
          });

        // Changes to one file run one after another, so two taps can't race.
        const queues = new Map<string, Promise<unknown>>();
        const serial = <T>(project: string, path: string, fn: () => Promise<T>): Promise<T> => {
          const key = `${project}\u0000${path}`;
          const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
          queues.set(key, next);
          return next;
        };

        const writeDisk = async (project: string, change: FileChange, content: string | null, force: boolean) => {
          if (content === change.disk) return;
          if (!force) {
            const current = await io.read(project, change.path);
            if (current !== change.disk) throw new ChangeConflictError(change.path);
          }
          await io.write(project, change.path, content);
        };

        // Moves one change to its next state and brings the disk along.
        const transition = (project: string, path: string, force: boolean, next: (c: FileChange) => { original: string | null; proposed: string }) =>
          serial(project, path, async () => {
            const change = files(project)[path];
            if (!change) return;
            const { original, proposed } = next(change);
            const resolved = original !== null && original === proposed;
            // A rejected new file: nothing left to add.
            // (Keeping always gives a text original, so this only happens on reject.)
            const dropped = original === null && proposed === '';
            if (resolved || dropped) {
              const final = dropped ? null : original;
              await writeDisk(project, change, final, force);
              if (final !== null && final !== change.base) await io.recordHistory?.(project, path, final, change.base);
              put(project, null, path);
              return;
            }
            // The disk follows whichever side it was showing.
            const target = change.disk === change.proposed ? proposed : change.disk === change.original ? original : change.disk;
            await writeDisk(project, change, target, force);
            put(project, { ...change, original, proposed, disk: target }, path);
          });

        const keepEverything = (c: FileChange) => ({ original: c.proposed, proposed: c.proposed });
        const rejectEverything = (c: FileChange) => ({ original: c.original, proposed: c.original ?? '' });

        const hunkAt = (c: FileChange, index: number) => {
          const hunk = changeHunks(c)[index];
          if (!hunk) throw new Error(`No hunk ${index} in ${c.path}`);
          return hunk;
        };

        const all = async (project: string, fn: (path: string) => Promise<void>) => {
          const errors: unknown[] = [];
          for (const path of Object.keys(files(project))) await fn(path).catch((e) => errors.push(e));
          if (errors.length) throw errors[0];
        };

        return {
          byProject: {},
          stage(project, path, current, proposed) {
            const existing = files(project)[path];
            const original = existing ? existing.original : current;
            if (original === proposed) {
              // Back to where it started: nothing pending, but the disk may hold an applied version.
              // Otherwise the change stays, so reviewing it puts the original back on disk.
              if (existing && existing.disk === original) put(project, null, path);
              else if (existing) put(project, { ...existing, proposed }, path);
              return files(project)[path] ?? null;
            }
            const change: FileChange = existing ? { ...existing, proposed } : { path, original, proposed, disk: current, base: current };
            put(project, change, path);
            return change;
          },
          keepHunk: (project, path, index, force = false) =>
            transition(project, path, force, (c) => {
              const hunk = hunkAt(c, index);
              return { original: applyHunk(c.original ?? '', c.proposed, hunk), proposed: c.proposed };
            }),
          rejectHunk: (project, path, index, force = false) =>
            transition(project, path, force, (c) => {
              const hunk = hunkAt(c, index);
              return { original: c.original, proposed: revertHunk(c.original ?? '', c.proposed, hunk) };
            }),
          keepFile: (project, path, force = false) => transition(project, path, force, keepEverything),
          rejectFile: (project, path, force = false) => transition(project, path, force, rejectEverything),
          keepAll: (project, force = false) => all(project, (path) => get().keepFile(project, path, force)),
          undoAll: (project, force = false) => all(project, (path) => get().rejectFile(project, path, force)),
          async applyToDisk(project) {
            if (Object.values(files(project)).some((c) => c.disk !== c.proposed)) await saveNow(get());
            for (const path of Object.keys(files(project))) {
              await serial(project, path, async () => {
                const change = files(project)[path];
                if (!change || change.disk === change.proposed) return;
                if ((await io.read(project, path)) !== change.disk) throw new ChangeConflictError(path);
                await io.write(project, path, change.proposed);
                put(project, { ...change, disk: change.proposed }, path);
              });
            }
          },
          async syncFromDisk(project) {
            for (const path of Object.keys(files(project))) {
              await serial(project, path, async () => {
                const change = files(project)[path];
                if (!change || change.disk !== change.proposed) return;
                const now = await io.read(project, path);
                if (now === null || now === change.disk) return;
                if (now === change.original) put(project, null, path);
                else put(project, { ...change, proposed: now, disk: now }, path);
              });
            }
          },
          forget: (project) =>
            set((s) => {
              const { [project]: _gone, ...rest } = s.byProject;
              return { byProject: rest };
            }),
        };
      },
      {
        name: CHANGES_STORAGE_KEY,
        version: CHANGES_VERSION,
        storage: createJSONStorage(() => storage),
        partialize: (s): Persisted => ({ byProject: s.byProject }),
        merge: mergeSaved,
      },
    ),
  );
}

export type ChangesStore = ReturnType<typeof createChangesStore>;
