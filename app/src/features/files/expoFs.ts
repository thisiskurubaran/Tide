import { Directory, File, Paths } from 'expo-file-system';

import { DirEntry, FsAdapter, dirname } from './fs';

// FsAdapter over the app's Documents directory.
export function createExpoFs(root: Directory = Paths.document): FsAdapter {
  const file = (path: string) => new File(root, path);
  const dir = (path: string) => (path ? new Directory(root, path) : root);

  return {
    async stat(path) {
      const info = Paths.info(dir(path).uri);
      if (!info.exists) return null;
      return info.isDirectory ? 'dir' : 'file';
    },
    async readDir(path) {
      return dir(path)
        .list()
        .map((e): DirEntry => ({ name: e.name, kind: e instanceof Directory ? 'dir' : 'file' }));
    },
    async mkdir(path) {
      dir(path).create({ intermediates: true, idempotent: true });
    },
    async readFile(path) {
      return file(path).text();
    },
    async size(path) {
      return file(path).size ?? 0;
    },
    async modified(path) {
      const f = file(path);
      return f.exists ? (f.modificationTime ?? null) : null;
    },
    async writeFile(path, content) {
      const parent = dirname(path);
      if (parent) dir(parent).create({ intermediates: true, idempotent: true });
      const f = file(path);
      if (!f.exists) f.create();
      await f.write(content);
    },
    async readBase64(path) {
      return file(path).base64();
    },
    async writeBase64(path, data) {
      const parent = dirname(path);
      if (parent) dir(parent).create({ intermediates: true, idempotent: true });
      const f = file(path);
      if (!f.exists) f.create();
      await f.write(data, { encoding: 'base64' });
    },
    async rename(path, newName) {
      const info = Paths.info(dir(path).uri);
      if (info.isDirectory) dir(path).rename(newName);
      else file(path).rename(newName);
    },
    async copyFile(from, to) {
      const parent = dirname(to);
      if (parent) dir(parent).create({ intermediates: true, idempotent: true });
      const target = file(to);
      if (!target.exists) target.create();
      // Bytes, not text, so binary files survive the copy.
      await target.write(await file(from).bytes());
    },
    async remove(path) {
      const info = Paths.info(dir(path).uri);
      if (!info.exists) throw new Error(`ENOENT: ${path}`);
      if (info.isDirectory) dir(path).delete();
      else file(path).delete();
    },
  };
}
