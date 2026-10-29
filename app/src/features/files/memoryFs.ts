import { DirEntry, EntryKind, FsAdapter, basename, dirname, joinPath } from './fs';

// In-memory adapter for tests. Directories are tracked explicitly so empty
// folders behave like they do on disk. Files are text; bytes that aren't
// valid UTF-8 (zips, images) are kept exactly in `binary`, as base64.
export function createMemoryFs(): FsAdapter & { files: Map<string, string>; dirs: Set<string> } {
  const files = new Map<string, string>();
  const binary = new Map<string, string>();
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
      binary.delete(path);
    },
    async readBase64(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return binary.get(path) ?? Buffer.from(content, 'utf8').toString('base64');
    },
    async writeBase64(path, data) {
      if (dirs.has(path)) throw new Error(`EISDIR: ${path}`);
      mkdirp(dirname(path));
      const bytes = Buffer.from(data, 'base64');
      const text = bytes.toString('utf8');
      files.set(path, text);
      if (Buffer.from(text, 'utf8').equals(bytes)) binary.delete(path);
      else binary.set(path, bytes.toString('base64'));
    },
    async rename(path, newName) {
      const target = joinPath(dirname(path), newName);
      if (kind(path) === null) throw new Error(`ENOENT: ${path}`);
      if (kind(target) !== null) throw new Error(`EEXIST: ${target}`);
      for (const [f, c] of [...files]) {
        if (under(f, path)) {
          files.delete(f);
          files.set(target + f.slice(path.length), c);
          const b = binary.get(f);
          binary.delete(f);
          if (b !== undefined) binary.set(target + f.slice(path.length), b);
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
      const b = binary.get(from);
      if (b !== undefined) binary.set(to, b);
      else binary.delete(to);
    },
    async remove(path) {
      if (kind(path) === null) throw new Error(`ENOENT: ${path}`);
      for (const f of [...files.keys()]) {
        if (!under(f, path)) continue;
        files.delete(f);
        binary.delete(f);
      }
      for (const d of [...dirs]) if (under(d, path)) dirs.delete(d);
    },
  };
}
