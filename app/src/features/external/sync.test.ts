import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { Folder, hashBytes, pull, push, pushFile } from './sync';

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
});
