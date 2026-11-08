import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { Folder, hashBytes, MAX_FILE_BYTES, pull, push, pushFile } from './sync';

const enc = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
const dec = (b: Uint8Array) => Buffer.from(b).toString('utf8');

export function memoryFolder(initial: Record<string, string>): Folder & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([p, s]) => [p, enc(s)]));
  return {
    files,
    listFiles: async () => [...files.keys()],
    read: async (p) => files.get(p)!,
    write: async (p, b) => void files.set(p, b),
    remove: async (p) => void files.delete(p),
  };
}

async function setup() {
  const workspace = createWorkspace(createMemoryFs());
  await workspace.createEmptyProject('p');
  const folder = memoryFolder({ 'index.js': 'one', 'src/a.js': 'a', 'node_modules/x.js': 'skip' });
  const first = await pull(folder, workspace, 'p', {});
  return { workspace, folder, manifest: first.manifest };
}

describe('linked folder sync', () => {
  it('copies the folder in, without rebuildable folders', async () => {
    const { workspace, manifest } = await setup();
    expect((await workspace.listFiles('p')).sort()).toEqual(['index.js', 'src/a.js']);
    expect(Object.keys(manifest).sort()).toEqual(['index.js', 'src/a.js']);
  });

  it('pushes edits, new files and deletions to the folder', async () => {
    const { workspace, folder, manifest } = await setup();
    await workspace.writeFile('p', 'index.js', 'two');
    await workspace.createFile('p', '', 'new.txt', 'n');
    await workspace.removeIfPresent('p', 'src/a.js');
    const r = await push(folder, workspace, 'p', manifest);
    expect([...folder.files.keys()].sort()).toEqual(['index.js', 'new.txt', 'node_modules/x.js']);
    expect(dec(folder.files.get('index.js')!)).toBe('two');
    expect(r).toMatchObject({ written: 2, removed: 1, overwritten: [] });
  });

  it('pulls changes and deletions, keeping files changed here that were deleted there', async () => {
    const { workspace, folder, manifest } = await setup();
    folder.files.set('index.js', enc('from mac'));
    folder.files.delete('src/a.js');
    await workspace.writeFile('p', 'src/a.js', 'edited here');
    const r = await pull(folder, workspace, 'p', manifest);
    expect(await workspace.readFile('p', 'index.js')).toBe('from mac');
    expect(await workspace.readFile('p', 'src/a.js')).toBe('edited here');
    expect(r.manifest['src/a.js']).toBe(hashBytes(enc('edited here')));
    // Pushing next puts it back in the folder rather than deleting it.
    await push(folder, workspace, 'p', r.manifest);
    expect(dec(folder.files.get('src/a.js')!)).toBe('edited here');
  });

  it('reports files changed on both sides', async () => {
    const { workspace, folder, manifest } = await setup();
    folder.files.set('index.js', enc('theirs'));
    await workspace.writeFile('p', 'index.js', 'ours');
    expect((await push(folder, workspace, 'p', manifest)).overwritten).toEqual(['index.js']);
  });

  it('pushes a single saved file', async () => {
    const { workspace, folder, manifest } = await setup();
    await workspace.writeFile('p', 'src/a.js', 'saved');
    const next = await pushFile(folder, workspace, 'p', 'src/a.js', manifest);
    expect(dec(folder.files.get('src/a.js')!)).toBe('saved');
    expect(next['src/a.js']).toBe(hashBytes(enc('saved')));
  });

  describe('files over the size limit (L14)', () => {
    const big = () => new Uint8Array(MAX_FILE_BYTES + 1);

    it('keeps the project copy of a synced file that grew too large in the folder', async () => {
      const { workspace, folder, manifest } = await setup();
      folder.files.set('src/a.js', big());
      const r = await pull(folder, workspace, 'p', manifest);
      expect(await workspace.readFile('p', 'src/a.js')).toBe('a');
      expect(r).toMatchObject({ removed: 0, tooLarge: ['src/a.js'] });
      // Still known as synced, so it isn't treated as new or deleted later.
      expect(r.manifest['src/a.js']).toBe(manifest['src/a.js']);
      // And it never deletes the folder copy on the way back either.
      const back = await push(folder, workspace, 'p', r.manifest);
      expect(folder.files.get('src/a.js')!.length).toBe(MAX_FILE_BYTES + 1);
      expect(back).toMatchObject({ written: 0, removed: 0, tooLarge: ['src/a.js'] });
    });

    it('keeps the folder copy of a synced file that grew too large here', async () => {
      const { workspace, folder, manifest } = await setup();
      await workspace.writeBase64('p', 'src/a.js', Buffer.from(big()).toString('base64'));
      const r = await push(folder, workspace, 'p', manifest);
      expect(dec(folder.files.get('src/a.js')!)).toBe('a');
      expect(r).toMatchObject({ removed: 0, written: 0, tooLarge: ['src/a.js'] });
      // A pull doesn't write the old small copy over the big one either.
      await pull(folder, workspace, 'p', r.manifest);
      expect((await workspace.listFiles('p')).includes('src/a.js')).toBe(true);
      expect((await workspace.readBase64('p', 'src/a.js')).length).toBeGreaterThan(MAX_FILE_BYTES);
    });

    // M2: a huge file is never read into memory; its size says it's too big.
    it('skips a file too large in the folder without reading it', async () => {
      const { workspace, folder, manifest } = await setup();
      const huge = MAX_FILE_BYTES * 50;
      folder.files.set('video.mov', enc('stand-in'));
      const read = folder.read;
      const sized: Folder = {
        ...folder,
        size: async (p) => (p === 'video.mov' ? huge : folder.files.get(p)?.length ?? null),
        read: async (p) => {
          if (p === 'video.mov') throw new Error('read a file over the limit');
          return read(p);
        },
      };
      const r = await pull(sized, workspace, 'p', manifest);
      expect(r.tooLarge).toEqual(['video.mov']);
      expect((await workspace.listFiles('p')).includes('video.mov')).toBe(false);
      // Nor on the way back, or when a save is pushed.
      await expect(push(sized, workspace, 'p', r.manifest)).resolves.toMatchObject({ tooLarge: ['video.mov'], removed: 0 });
      await workspace.createFile('p', '', 'video.mov', 'small here');
      expect(await pushFile(sized, workspace, 'p', 'video.mov', r.manifest)).toBe(r.manifest);
      expect(dec(folder.files.get('video.mov')!)).toBe('stand-in');
    });

    it('skips a file too large in the project without reading it', async () => {
      const { workspace, folder, manifest } = await setup();
      await workspace.writeBase64('p', 'src/a.js', Buffer.from(big()).toString('base64'));
      const readBase64 = jest.spyOn(workspace, 'readBase64');
      const r = await push(folder, workspace, 'p', manifest);
      expect(r.tooLarge).toEqual(['src/a.js']);
      expect(readBase64.mock.calls.map(([, p]) => p)).not.toContain('src/a.js');
      // A save of it isn't pushed either.
      expect(await pushFile(folder, workspace, 'p', 'src/a.js', manifest)).toBe(manifest);
      expect(readBase64.mock.calls.map(([, p]) => p)).not.toContain('src/a.js');
      expect(dec(folder.files.get('src/a.js')!)).toBe('a');
    });

    it("reads each file again when writing it, so a side's contents aren't all held at once", async () => {
      const { workspace, folder, manifest } = await setup();
      folder.files.set('index.js', enc('changed'));
      const reads: string[] = [];
      const read = folder.read;
      const r = await pull({ ...folder, read: async (p) => (reads.push(p), read(p)) }, workspace, 'p', manifest);
      expect(r.written).toBe(1);
      // Listed (hashed) once each, and read once more for the one write.
      expect(reads.sort()).toEqual(['index.js', 'index.js', 'src/a.js']);
      expect(await workspace.readFile('p', 'index.js')).toBe('changed');
    });
  });
});
