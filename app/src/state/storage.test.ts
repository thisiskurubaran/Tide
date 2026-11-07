import { createStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createMemoryFs } from '../features/files/memoryFs';
import { hydrated } from './hydrated';
import { createFsStorage } from './storage';
import { createTabsStore } from './tabs';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createFsStorage', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => (warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)));
  afterEach(() => warn.mockRestore());

  it('round-trips values and leaves no .tmp behind', async () => {
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    await storage.setItem('a', '{"x":1}');
    await storage.setItem('a', '{"x":2}');
    expect(await storage.getItem('a')).toBe('{"x":2}');
    expect(await fs.stat('.tide/a.json.tmp')).toBeNull();
    await storage.removeItem('a');
    expect(await storage.getItem('a')).toBeNull();
  });

  it('keeps writes in order when they overlap', async () => {
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    await Promise.all([storage.setItem('a', '"1"'), storage.setItem('a', '"2"'), storage.setItem('a', '"3"')]);
    expect(await storage.getItem('a')).toBe('"3"');
  });

  it.each([['empty', ''], ['truncated', '{"state":{"byProj']])('moves a %s file aside and returns null', async (_label, text) => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/tabs.json', text);
    const storage = createFsStorage(fs);
    expect(await storage.getItem('tabs')).toBeNull();
    expect(await fs.stat('.tide/tabs.json')).toBeNull();
    expect(await fs.readFile('.tide/tabs.json.corrupt')).toBe(text);
    expect(warn).toHaveBeenCalled();
  });

  it('recovers a complete write that was not renamed into place', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json.tmp', '{"x":3}');
    const storage = createFsStorage(fs);
    expect(await storage.getItem('a')).toBe('{"x":3}');
    expect(await fs.readFile('.tide/a.json')).toBe('{"x":3}');
  });

  it('ignores a damaged .tmp', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json.tmp', '{"x"');
    expect(await createFsStorage(fs).getItem('a')).toBeNull();
  });

  it('lets a persisted store hydrate with defaults from a damaged file', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/tabs.json', '');
    const tabs = createTabsStore(createFsStorage(fs));
    await hydrated(tabs, 1000);
    expect(tabs.persist.hasHydrated()).toBe(true);
    expect(tabs.getState().byProject).toEqual({});
    // And it saves normally afterwards.
    tabs.getState().openTab('p', 'a.js');
    await flush();
    expect(JSON.parse(await fs.readFile('.tide/tabs.json')).state.byProject.p.open).toEqual(['a.js']);
  });
});

describe('hydrated', () => {
  it('resolves even when hydration fails and never finishes', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createStore<{ n: number }>()(
      persist(() => ({ n: 0 }), {
        name: 'broken',
        storage: createJSONStorage(() => ({
          getItem: async () => {
            throw new Error('disk on fire');
          },
          setItem: async () => undefined,
          removeItem: async () => undefined,
        })),
      }),
    );
    await flush();
    expect(store.persist.hasHydrated()).toBe(false);
    await expect(hydrated(store, 10)).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('resolves as soon as the store has hydrated', async () => {
    const tabs = createTabsStore(createFsStorage(createMemoryFs()));
    await expect(hydrated(tabs, 60_000)).resolves.toBeUndefined();
  });
});
