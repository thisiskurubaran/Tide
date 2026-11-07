// Local history: earlier versions of each file, kept on every save so a change
// can be undone without Git. Versions live under .tide/history/<project>/<file>/
// as <time>.txt. Autosave writes often, so saves close together update the
// newest version instead of adding one; the version from before the first save
// in a session is kept too.
import { FsAdapter, joinPath } from '../files/fs';
import { STATE_DIR } from '../../state/storage';

export interface Version {
  id: string;
  time: number;
  bytes: number;
}

// Saves within this long of the newest version replace it.
export const MERGE_MS = 2 * 60 * 1000;
// Per file, newest first.
export const KEEP = 50;
// Bigger files aren't kept; history is for code and notes.
export const MAX_BYTES = 1024 * 1024;

const projectDir = (project: string) => joinPath(STATE_DIR, 'history', project);
const fileDir = (project: string, path: string) => joinPath(projectDir(project), encodeURIComponent(path));

export function createHistory(fs: FsAdapter, now: () => number = Date.now) {
  async function list(project: string, path: string): Promise<Version[]> {
    const dir = fileDir(project, path);
    if ((await fs.stat(dir)) !== 'dir') return [];
    const out: Version[] = [];
    for (const e of await fs.readDir(dir)) {
      const m = /^(\d+)\.txt$/.exec(e.name);
      if (!m || e.kind !== 'file') continue;
      out.push({ id: e.name, time: Number(m[1]), bytes: await fs.size(joinPath(dir, e.name)) });
    }
    return out.sort((a, b) => b.time - a.time);
  }

  const read = (project: string, path: string, id: string) => fs.readFile(joinPath(fileDir(project, path), id));

  async function write(project: string, path: string, content: string, time: number) {
    await fs.writeFile(joinPath(fileDir(project, path), `${time}.txt`), content);
  }

  // Each file's saves run one after another, so merging never races.
  const queues = new Map<string, Promise<unknown>>();

  // `before` is what was on disk before this save, kept as its own version
  // when the newest version is older than the merge window.
  async function record(project: string, path: string, content: string, before?: string) {
    if (content.length > MAX_BYTES || content.includes('\u0000')) return;
    const time = now();
    const versions = await list(project, path);
    const [newest] = versions;
    if (newest && (await read(project, path, newest.id)) === content) return;
    if (newest && time - newest.time < MERGE_MS) {
      // Same editing session: the newest version becomes this save.
      await fs.remove(joinPath(fileDir(project, path), newest.id));
    } else if (before !== undefined && before !== content && before.length <= MAX_BYTES && (!newest || (await read(project, path, newest.id)) !== before)) {
      await write(project, path, before, time - 1);
    }
    await write(project, path, content, time);
    for (const old of (await list(project, path)).slice(KEEP)) await fs.remove(joinPath(fileDir(project, path), old.id));
  }

  return {
    list,
    read,
    record(project: string, path: string, content: string, before?: string) {
      const key = `${project}\u0000${path}`;
      const next = (queues.get(key) ?? Promise.resolve()).then(() => record(project, path, content, before)).catch(() => undefined);
      queues.set(key, next);
      return next;
    },
    async remove(project: string, path: string, id: string) {
      await fs.remove(joinPath(fileDir(project, path), id));
    },
    async renamePath(project: string, from: string, to: string) {
      if ((await fs.stat(fileDir(project, from))) === 'dir') await fs.rename(fileDir(project, from), encodeURIComponent(to));
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
