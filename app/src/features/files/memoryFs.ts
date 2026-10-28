import { DirEntry, EntryKind, FsAdapter, basename, dirname, joinPath } from './fs';

// In-memory adapter for tests. Directories are tracked explicitly so empty
// folders behave like they do on disk.
export function createMemoryFs(): FsAdapter & { files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['']);

  const kind = (path: string): EntryKind | null => (files.has(path) ? 'file' : dirs.has(path) ? 'dir' : null);

  function mkdirp(path: string) {
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (files.has(p)) throw new Error(`ENOTDIR: ${p}`);
      dirs.add(p);
    }
  }

  function under(path: string, prefix: string) {
    return path === prefix || path.startsWith(`${prefix}/`);
  }

  return {
    files,
    dirs,
    async stat(path) {
      return kind(path);
    },
    async readDir(path) {
      if (kind(path) !== 'dir') throw new Error(`ENOENT: ${path}`);
      const entries: DirEntry[] = [];
      for (const d of dirs) if (d && dirname(d) === path) entries.push({ name: basename(d), kind: 'dir' });
      for (const f of files.keys()) if (dirname(f) === path) entries.push({ name: basename(f), kind: 'file' });
      return entries;
    },
    async mkdir(path) {
      mkdirp(path);
    },
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async writeFile(path, content) {
      if (dirs.has(path)) throw new Error(`EISDIR: ${path}`);
      mkdirp(dirname(path));
      files.set(path, content);
    },
    // Files are stored as text here, so only UTF-8 content round-trips.
    async readBase64(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return Buffer.from(content, 'utf8').toString('base64');
    },
    async writeBase64(path, data) {
      if (dirs.has(path)) throw new Error(`EISDIR: ${path}`);
      mkdirp(dirname(path));
      files.set(path, Buffer.from(data, 'base64').toString('utf8'));
    },
    async rename(path, newName) {
      const target = joinPath(dirname(path), newName);
      if (kind(path) === null) throw new Error(`ENOENT: ${path}`);
      if (kind(target) !== null) throw new Error(`EEXIST: ${target}`);
      for (const [f, c] of [...files]) {
        if (under(f, path)) {
          files.delete(f);
          files.set(target + f.slice(path.length), c);
        }
      }
      for (const d of [...dirs]) {
        if (under(d, path)) {
          dirs.delete(d);
          dirs.add(target + d.slice(path.length));
        }
      }
    },
    async copyFile(from, to) {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT: ${from}`);
      if (dirs.has(to)) throw new Error(`EISDIR: ${to}`);
      mkdirp(dirname(to));
      files.set(to, content);
    },
    async remove(path) {
      if (kind(path) === null) throw new Error(`ENOENT: ${path}`);
      for (const f of [...files.keys()]) if (under(f, path)) files.delete(f);
      for (const d of [...dirs]) if (under(d, path)) dirs.delete(d);
    },
  };
}
