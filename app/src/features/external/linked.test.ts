import { createBuffersStore } from '../../state/buffers';
import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { createLinkedStore, createLinkedSync } from './linked';
import type { Folder } from './sync';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

function folder(): Folder & { files: Map<string, string> } {
  const files = new Map<string, string>([['main.py', 'print(1)']]);
  return {
    files,
    listFiles: async () => [...files.keys()],
    read: async (p) => new Uint8Array(Buffer.from(files.get(p)!)),
    write: async (p, b) => void files.set(p, Buffer.from(b).toString()),
    remove: async (p) => void files.delete(p),
  };
}

async function setup() {
  const workspace = createWorkspace(createMemoryFs());
  await workspace.createEmptyProject('p');
  const store = createLinkedStore(memoryStorage());
  const outside = folder();
  const sync = createLinkedSync(store, workspace, () => outside);
  store.getState().link('p', 'file:///outside', 'outside');
  await sync.pull('p');
  return { workspace, store, outside, sync };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('linked folders', () => {
  it('pulls the folder in and remembers when', async () => {
    const { workspace, store } = await setup();
    expect(await workspace.readFile('p', 'main.py')).toBe('print(1)');
    expect(store.getState().links.p.syncedAt).toEqual(expect.any(Number));
  });

  it('writes saved files through to the folder', async () => {
    const { workspace, store, outside, sync } = await setup();
    const buffers = createBuffersStore(workspace, 10);
    sync.watch(buffers);
    await buffers.getState().load('p', 'main.py');
    buffers.getState().edit('p', 'main.py', 'print(2)');
    await buffers.getState().save('p', 'main.py');
    await settle();
    await settle();
    expect(outside.files.get('main.py')).toBe('print(2)');

    store.getState().update('p', { pushOnSave: false });
    buffers.getState().edit('p', 'main.py', 'print(3)');
    await buffers.getState().save('p', 'main.py');
    await settle();
    expect(outside.files.get('main.py')).toBe('print(2)');
  });

  it('follows project renames and drops unlinked projects', async () => {
    const { store } = await setup();
    store.getState().renameProject('p', 'q');
    expect(Object.keys(store.getState().links)).toEqual(['q']);
    store.getState().unlink('q');
    expect(store.getState().links).toEqual({});
  });
});
