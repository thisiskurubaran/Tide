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
// and Review, Keep, Reject and Undo still work after a relaunch. Saving is
// coalesced (every staged edit would otherwise rewrite the whole file), except
// right before run_command writes to disk, which waits for the save. `disk` is
// only a record: before acting on a file, and after a relaunch, the file
// itself is read and compared with `original` and `proposed`.
//
// Records carry the project's identity (projectIdentity.ts), so a project
// deleted in the Files app and made again under the same name doesn't get
// them back. They move with a rename. Where the identity isn't reliable
// (Android) none is kept, and records are only dropped when the project's
// folder is gone or the project is deleted in Tide.
import { createStore } from 'zustand';
import { persist, PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

import { applyHunk, diffText, Hunk, revertHunk } from '../../extensions/gitPro/diff';
import { Identify, identityReliable, sameProject } from './projectIdentity';

export interface FileChange {
  path: string;
  original: string | null;
  proposed: string;
  disk: string | null;
  // The file as the agent found it, for local history.
  base: string | null;
  // Saved (and waited for) before run_command writes `proposed` to disk, and
  // cleared once it's written: a record found with it after a relaunch may or
  // may not have reached the disk, so the file is read to tell.
  applying?: string;
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

// run_command's intent to write pending changes couldn't be saved, so nothing
// was written: after a crash the originals would be lost.
export class ChangesNotSavedError extends Error {
  constructor(readonly reason: unknown) {
    super("The agent's pending changes couldn't be saved, so they weren't written to disk.");
  }
}

export interface ChangesState {
  byProject: Record<string, Record<string, FileChange>>;
  // Each project's identity when its changes were staged (see projectIdentity.ts).
  owners: Record<string, string>;
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
  // The project was renamed: its changes go with it.
  renameProject(from: string, to: string): void;
  // Checks saved changes against the project and its files: drops them if the
  // project is gone or is a different one now, and corrects `disk` from what
  // the files really hold. Run after loading.
  reconcile(project: string): Promise<void>;
  reconcileAll(): Promise<void>;
  // Writes any coalesced save now (the app is going to the background).
  flush(): Promise<void>;
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

type Persisted = Pick<ChangesState, 'byProject' | 'owners'>;

// Nothing saved: for tests. Hydrates synchronously.
const noStorage: StateStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

// Saved changes load under any staged before loading finished (those are newer).
// Saved owners are dropped when identities can't be trusted here: on Android
// they were folder modification times (see projectIdentity.ts).
function mergeSaved(saved: unknown, current: ChangesState, trustOwners: boolean): ChangesState {
  const byProject = { ...current.byProject };
  const s = saved as Partial<Persisted> | undefined;
  const stored = s?.byProject;
  if (stored && typeof stored === 'object') {
    for (const [project, files] of Object.entries(stored)) byProject[project] = { ...files, ...current.byProject[project] };
  }
  const owners = { ...(trustOwners && s?.owners && typeof s.owners === 'object' ? s.owners : {}), ...current.owners };
  return { ...current, byProject, owners };
}

const partialize = (s: ChangesState): Persisted => ({ byProject: s.byProject, owners: s.owners });

// persist saves after every change, with full copies of each changed file.
// This keeps only the latest state and writes it once things settle (or at
// once, on flush), one write at a time.
function coalescingStorage(storage: StateStorage, delayMs: number) {
  let latest: StorageValue<Persisted> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  // Resolves once written; `attempt` rejects if this write failed.
  const write = (): { writing: Promise<void>; attempt: Promise<void> } => {
    if (timer) clearTimeout(timer);
    timer = null;
    const value = latest;
    latest = null;
    if (!value) return { writing, attempt: writing };
    const attempt = writing.then(async () => {
      await storage.setItem(CHANGES_STORAGE_KEY, JSON.stringify(value));
    });
    writing = attempt.catch((e) => console.warn('Could not save the agent\'s pending changes', e));
    return { writing, attempt };
  };
  const flush = (): Promise<void> => write().writing;

  const persistStorage: PersistStorage<Persisted> = {
    async getItem(name) {
      const raw = await storage.getItem(name);
      return raw ? (JSON.parse(raw) as StorageValue<Persisted>) : null;
    },
    setItem(_name, value) {
      if (storage === noStorage) return;
      latest = value;
      if (!timer) timer = setTimeout(() => void flush(), delayMs);
    },
    removeItem: (name) => storage.removeItem(name),
  };

  // Saves `state` now and resolves once it's written; rejects if it wasn't.
  const saveNow = (state: Persisted): Promise<void> => {
    if (storage === noStorage) return Promise.resolve();
    latest = { state, version: CHANGES_VERSION };
    return write().attempt;
  };

  return { persistStorage, flush, saveNow };
}

export interface ChangesOptions {
  // The project's identity; without it, records are matched by name only.
  identify?: Identify;
  // How long saves are held to be coalesced.
  saveDelayMs?: number;
}

// `storage` keeps pending changes across launches (see the top of this file).
export function createChangesStore(io: ChangeIo, storage: StateStorage = noStorage, { identify, saveDelayMs = 500 }: ChangesOptions = {}) {
  const saving = coalescingStorage(storage, saveDelayMs);
  const trusted = identityReliable(identify);
  // The project's identity as far as it can be trusted here ('' = unknown).
  const known = async (project: string): Promise<string | null> => {
    if (!identify) return '';
    const id = await identify(project).catch(() => '');
    return id === null ? null : trusted ? id : '';
  };

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

        // put, after awaiting: only if the record is still there. A rename (or
        // delete) while a Keep or apply was writing has moved it; writing it
        // back under the old name would bring the old project's records back.
        const update = (project: string, change: FileChange | null, path: string) => {
          if (get().byProject[project]?.[path]) put(project, change, path);
        };

        // Changes to one file run one after another, so two taps can't race.
        const queues = new Map<string, Promise<unknown>>();
        const serial = <T>(project: string, path: string, fn: () => Promise<T>): Promise<T> => {
          const key = `${project}\u0000${path}`;
          const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
          queues.set(key, next);
          return next;
        };

        // The change with `disk` taken from the file itself: the record can be
        // behind it (the app was killed between a write and its save). The
        // file is returned too, as `actual`.
        const settle = async (project: string, path: string): Promise<{ change: FileChange; actual: string | null } | null> => {
          const change = files(project)[path];
          if (!change) return null;
          const actual = await io.read(project, path);
          let disk = change.disk;
          if (actual === change.proposed) disk = change.proposed;
          else if (actual === change.original) disk = change.original;
          else if (change.applying !== undefined && actual === change.applying) disk = change.applying;
          if (disk === change.disk && change.applying === undefined) return { change, actual };
          const { applying: _done, ...rest } = change;
          const next = { ...rest, disk };
          update(project, next, path);
          return { change: next, actual };
        };

        const writeDisk = async (project: string, change: FileChange, actual: string | null, content: string | null, force: boolean) => {
          if (content === actual) return;
          if (!force && actual !== change.disk) throw new ChangeConflictError(change.path);
          await io.write(project, change.path, content);
        };

        // Moves one change to its next state and brings the disk along.
        const transition = (project: string, path: string, force: boolean, next: (c: FileChange) => { original: string | null; proposed: string }) =>
          serial(project, path, async () => {
            const settled = await settle(project, path);
            if (!settled) return;
            const { change, actual } = settled;
            const { original, proposed } = next(change);
            const resolved = original !== null && original === proposed;
            // A rejected new file: nothing left to add.
            // (Keeping always gives a text original, so this only happens on reject.)
            const dropped = original === null && proposed === '';
            if (resolved || dropped) {
              const final = dropped ? null : original;
              await writeDisk(project, change, actual, final, force);
              if (final !== null && final !== change.base) await io.recordHistory?.(project, path, final, change.base);
              update(project, null, path);
              return;
            }
            // The disk follows whichever side it was showing.
            const target = change.disk === change.proposed ? proposed : change.disk === change.original ? original : change.disk;
            await writeDisk(project, change, actual, target, force);
            update(project, { ...change, original, proposed, disk: target }, path);
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

        // Notes whose project these changes are, the first time one is staged.
        const claiming = new Set<string>();
        const claim = (project: string) => {
          if (!identify || !trusted || get().owners[project] || claiming.has(project)) return;
          claiming.add(project);
          known(project)
            .then((id) => {
              if (id && !get().owners[project] && Object.keys(files(project)).length) set((s) => ({ owners: { ...s.owners, [project]: id } }));
            })
            .catch(() => undefined)
            .finally(() => claiming.delete(project));
        };

        const forget = (project: string) =>
          set((s) => {
            const { [project]: _gone, ...rest } = s.byProject;
            const { [project]: _owner, ...owners } = s.owners;
            return { byProject: rest, owners };
          });

        return {
          byProject: {},
          owners: {},
          stage(project, path, current, proposed) {
            claim(project);
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
            // The intent is on record, with the originals, before any file is written.
            const toApply = Object.values(files(project)).filter((c) => c.disk !== c.proposed);
            if (toApply.length) {
              for (const c of toApply) put(project, { ...c, applying: c.proposed }, c.path);
              try {
                await saving.saveNow(partialize(get()));
              } catch (e) {
                // Without the intent on record, a crash mid-write would lose the
                // originals: write nothing.
                for (const c of toApply) {
                  const now = files(project)[c.path];
                  if (now?.applying !== undefined) {
                    const { applying: _undo, ...rest } = now;
                    put(project, rest, c.path);
                  }
                }
                throw new ChangesNotSavedError(e);
              }
            }
            for (const path of Object.keys(files(project))) {
              await serial(project, path, async () => {
                const change = files(project)[path];
                if (!change) return;
                const { applying: _done, ...done } = change;
                if (change.disk === change.proposed) {
                  if (change.applying !== undefined) put(project, done, path);
                  return;
                }
                const actual = await io.read(project, path);
                if (actual !== change.proposed) {
                  if (actual !== change.disk) {
                    update(project, done, path);
                    throw new ChangeConflictError(path);
                  }
                  await io.write(project, path, change.proposed);
                }
                update(project, { ...done, disk: change.proposed }, path);
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
                if (now === change.original) update(project, null, path);
                else update(project, { ...change, proposed: now, disk: now }, path);
              });
            }
          },
          forget,
          renameProject(from, to) {
            if (from === to) return;
            set((s) => {
              const moved = s.byProject[from];
              const owner = s.owners[from];
              const { [from]: _gone, ...byProject } = s.byProject;
              const { [from]: _owner, ...owners } = s.owners;
              if (moved) byProject[to] = { ...moved, ...byProject[to] };
              if (owner) owners[to] = owner;
              return { byProject, owners };
            });
          },
          async reconcile(project) {
            if (!Object.keys(files(project)).length) {
              if (get().owners[project]) forget(project);
              return;
            }
            if (identify) {
              const id = await known(project);
              // Deleted outside Tide, or (only where identities are reliable) a
              // different project under the same name.
              if (id === null || (trusted && !sameProject(get().owners[project], id))) {
                forget(project);
                return;
              }
              if (id && !get().owners[project] && Object.keys(files(project)).length) set((s) => ({ owners: { ...s.owners, [project]: id } }));
            }
            for (const path of Object.keys(files(project))) await serial(project, path, () => settle(project, path)).catch(() => undefined);
          },
          async reconcileAll() {
            for (const project of Object.keys(get().byProject)) await get().reconcile(project);
          },
          flush: () => saving.flush(),
        };
      },
      {
        name: CHANGES_STORAGE_KEY,
        version: CHANGES_VERSION,
        storage: saving.persistStorage,
        partialize,
        merge: (saved, current) => mergeSaved(saved, current, trusted),
      },
    ),
  );
}

export type ChangesStore = ReturnType<typeof createChangesStore>;
