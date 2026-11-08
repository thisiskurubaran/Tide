// Local history: earlier versions of each file, kept on every save so a change
// can be undone without Git. Versions live under .tide/history/<project>/<file>/
// as <time>.txt, or <created>-<time>.txt for a version that later saves
// updated. Autosave writes often, so saves within MERGE_MS of when the newest
// version was created update it instead of adding one; the version from
// before the first save in a session is kept too, and so is the text before a
// save that replaces most of the file or restores an older version.
import { FsAdapter, joinPath } from '../files/fs';
import { STATE_DIR } from '../../state/storage';

export interface Version {
  id: string;
  // Last saved.
  time: number;
  // When the version started; the merge window counts from here.
  created: number;
  bytes: number;
}

// Saves within this long of the newest version's creation replace it.
export const MERGE_MS = 2 * 60 * 1000;
// Per file, newest first.
export const KEEP = 50;
// Bigger files aren't kept; history is for code and notes.
export const MAX_BYTES = 1024 * 1024;

const projectDir = (project: string) => joinPath(STATE_DIR, 'history', project);
const fileDir = (project: string, path: string) => joinPath(projectDir(project), encodeURIComponent(path));
const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

// True when going from `before` to `after` removes or rewrites at least half
// of `before`: select-all-and-delete, a paste over everything, a restore.
export function replacesMost(before: string, after: string): boolean {
  if (!before) return false;
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return before.length - start - end >= before.length / 2;
}

export function createHistory(fs: FsAdapter, now: () => number = Date.now) {
  async function list(project: string, path: string): Promise<Version[]> {
    const dir = fileDir(project, path);
    if ((await fs.stat(dir)) !== 'dir') return [];
    const out: Version[] = [];
    for (const e of await fs.readDir(dir)) {
      const m = /^(?:(\d+)-)?(\d+)\.txt$/.exec(e.name);
      if (!m || e.kind !== 'file') continue;
      const time = Number(m[2]);
      out.push({ id: e.name, time, created: m[1] ? Number(m[1]) : time, bytes: await fs.size(joinPath(dir, e.name)) });
    }
    return out.sort((a, b) => b.time - a.time);
  }

  const read = (project: string, path: string, id: string) => fs.readFile(joinPath(fileDir(project, path), id));

  async function write(project: string, path: string, content: string, time: number, created = time) {
    await fs.writeFile(joinPath(fileDir(project, path), created === time ? `${time}.txt` : `${created}-${time}.txt`), content);
  }

  // Each file's saves run one after another, so merging never races.
  const queues = new Map<string, Promise<unknown>>();
  // Files whose next save starts a version of its own (a restore is coming).
  const keepNext = new Set<string>();

  // `before` is what was on disk before this save, kept as its own version
  // when the newest version is older than the merge window, or when this save
  // replaces most of it or is a restore (`keep`).
  async function record(project: string, path: string, content: string, before?: string, keep = false) {
    if (content.length > MAX_BYTES || content.includes('\u0000')) return;
    const time = now();
    const versions = await list(project, path);
    const [newest] = versions;
    const newestText = newest ? await read(project, path, newest.id) : null;
    if (newestText === content) return;
    const big = keep || (before !== undefined && replacesMost(before, content));
    if (newest && time - newest.created < MERGE_MS && !big) {
      // Same editing session: the newest version becomes this save, and keeps its start.
      await fs.remove(joinPath(fileDir(project, path), newest.id));
      await write(project, path, content, time, newest.created);
    } else {
      if (before !== undefined && before !== content && before.length <= MAX_BYTES && !before.includes('\u0000') && newestText !== before) {
        await write(project, path, before, Math.max(time - 1, (newest?.time ?? 0) + 1));
      }
      await write(project, path, content, Math.max(time, (newest?.time ?? 0) + 2));
    }
    for (const old of (await list(project, path)).slice(KEEP)) await fs.remove(joinPath(fileDir(project, path), old.id));
  }

  return {
    list,
    read,
    record(project: string, path: string, content: string, before?: string) {
      const key = `${project}\u0000${path}`;
      const keep = keepNext.delete(key);
      const next = (queues.get(key) ?? Promise.resolve()).then(() => record(project, path, content, before, keep)).catch(() => undefined);
      queues.set(key, next);
      return next;
    },
    // The next save of this file is a restore: it gets a version of its own
    // instead of replacing the newest, so the text it replaces is kept.
    keepNext(project: string, path: string) {
      keepNext.add(`${project}\u0000${path}`);
    },
    async remove(project: string, path: string, id: string) {
      await fs.remove(joinPath(fileDir(project, path), id));
    },
    // A file or a folder: every file under it follows. Versions an unrelated,
    // older file left at the new path are dropped, not inherited.
    async renamePath(project: string, from: string, to: string) {
      if (from === to || (await fs.stat(projectDir(project))) !== 'dir') return;
      for (const e of await fs.readDir(projectDir(project))) {
        if (e.kind !== 'dir') continue;
        let path: string;
        try {
          path = decodeURIComponent(e.name);
        } catch {
          continue;
        }
        if (!isUnder(path, from)) continue;
        const target = to + path.slice(from.length);
        if ((await fs.stat(fileDir(project, target))) !== null) await fs.remove(fileDir(project, target));
        await fs.rename(fileDir(project, path), encodeURIComponent(target));
      }
    },
    // A deleted file or folder: its versions go too, so a new file created
    // at the same path starts with an empty history.
    async removePath(project: string, path: string) {
      if ((await fs.stat(projectDir(project))) !== 'dir') return;
      for (const e of await fs.readDir(projectDir(project))) {
        let decoded: string;
        try {
          decoded = decodeURIComponent(e.name);
        } catch {
          continue;
        }
        if (e.kind === 'dir' && isUnder(decoded, path)) await fs.remove(joinPath(projectDir(project), e.name));
      }
    },
    async renameProject(from: string, to: string) {
      if ((await fs.stat(projectDir(from))) === 'dir') await fs.rename(projectDir(from), to);
    },
    async removeProject(project: string) {
      if ((await fs.stat(projectDir(project))) === 'dir') await fs.remove(projectDir(project));
    },
  };
}

export type History = ReturnType<typeof createHistory>;
