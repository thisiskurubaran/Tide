import { createStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { createMemoryFs } from '../features/files/memoryFs';
import { allLoaded, hydrated } from './hydrated';
import { createFsStorage, onStateFileReadable, StateNotSavedError } from './storage';
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

  it('prefers a complete .tmp over the older main file', async () => {
    // The app died after writing the .tmp but before replacing name.json.
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json', '{"x":1}');
    await fs.writeFile('.tide/a.json.tmp', '{"x":2}');
    const storage = createFsStorage(fs);
    expect(await storage.getItem('a')).toBe('{"x":2}');
    expect(await fs.readFile('.tide/a.json')).toBe('{"x":2}');
    expect(await fs.stat('.tide/a.json.tmp')).toBeNull();
  });

  it('keeps the main file when the .tmp was cut short', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json', '{"x":1}');
    await fs.writeFile('.tide/a.json.tmp', '{"x":');
    expect(await createFsStorage(fs).getItem('a')).toBe('{"x":1}');
  });

  it('leaves a file it could not read in place and never writes over it', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json', '{"x":1}');
    const readFile = fs.readFile.bind(fs);
    const spy = jest.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('EIO'));
    const storage = createFsStorage(fs);
    expect(await storage.getItem('a')).toBeNull();
    expect(await fs.stat('.tide/a.json.corrupt')).toBeNull();
    await storage.setItem('a', '{"x":"defaults"}');
    spy.mockRestore();
    expect(await readFile('.tide/a.json')).toBe('{"x":1}');
    // A later successful read (rehydrate) allows saving again.
    expect(await storage.getItem('a')).toBe('{"x":1}');
    await storage.setItem('a', '{"x":2}');
    expect(await fs.readFile('.tide/a.json')).toBe('{"x":2}');
  });

  it('quarantines only a file that is not valid JSON (L2)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json', '{"x":1}');
    await fs.writeFile('.tide/b.json', '{"x":');
    // An I/O error from stat (on the .tmp check) is not damage.
    const spy = jest.spyOn(fs, 'stat').mockRejectedValueOnce(new Error('EACCES'));
    const storage = createFsStorage(fs);
    expect(await storage.getItem('a')).toBeNull();
    spy.mockRestore();
    expect(await fs.readFile('.tide/a.json')).toBe('{"x":1}');
    expect(await fs.stat('.tide/a.json.corrupt')).toBeNull();
    // Bad JSON is moved aside, keeping a copy.
    expect(await storage.getItem('b')).toBeNull();
    expect(await fs.stat('.tide/b.json')).toBeNull();
    expect(await fs.readFile('.tide/b.json.corrupt')).toBe('{"x":');
    warn.mockRestore();
  });

  it('gives up on a read that hangs, without writing over the file', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json', '{"x":1}');
    const spy = jest.spyOn(fs, 'readFile').mockReturnValueOnce(new Promise(() => undefined));
    const storage = createFsStorage(fs, { readTimeoutMs: 10 });
    expect(await storage.getItem('a')).toBeNull();
    spy.mockRestore();
    await storage.setItem('a', '{}');
    expect(await fs.readFile('.tide/a.json')).toBe('{"x":1}');
  });

  it('does not let a store save its defaults before its saved state has loaded', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/tabs.json', JSON.stringify({ state: { byProject: { p: { open: ['saved.js'], active: 'saved.js' } }, lastProject: 'p', recent: ['p'] }, version: 1 }));
    // A slow disk: the read takes a while.
    const readFile = fs.readFile.bind(fs);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    jest.spyOn(fs, 'readFile').mockImplementation(async (p: string) => {
      await gate;
      return readFile(p);
    });
    const tabs = createTabsStore(createFsStorage(fs));
    // Something changes state before hydration finishes.
    tabs.getState().setLastProject('other');
    await flush();
    release();
    await hydrated(tabs, 1000);
    expect(tabs.getState().byProject.p.open).toEqual(['saved.js']);
    expect(JSON.parse(await readFile('.tide/tabs.json')).state.byProject.p.open).toEqual(['saved.js']);
  });

  it('tells a caller that needs the write that it was skipped (M1)', async () => {
    const fs = createMemoryFs();
    await fs.writeFile('.tide/a.json', '{"x":1}');
    const spy = jest.spyOn(fs, 'readFile').mockReturnValueOnce(new Promise(() => undefined));
    const storage = createFsStorage(fs, { readTimeoutMs: 10 });
    expect(await storage.getItem('a')).toBeNull();
    spy.mockRestore();
    expect(storage.isBlocked('a')).toBe(true);
    // persist's writes stay quiet; a write that must land rejects.
    await expect(storage.setItem('a', '{}')).resolves.toBeUndefined();
    await expect(storage.setItemStrict('a', '{}')).rejects.toBeInstanceOf(StateNotSavedError);
    expect(await fs.readFile('.tide/a.json')).toBe('{"x":1}');
    // A file never read is written as usual.
    expect(storage.isBlocked('b')).toBe(false);
    await storage.setItemStrict('b', '{"y":1}');
    expect(await fs.readFile('.tide/b.json')).toBe('{"y":1}');
  });

  it('reloads a store whose read timed out once the read finishes, and saves it again (M1)', async () => {
    const fs = createMemoryFs();
    const saved = { state: { byProject: { p: { open: ['saved.js'], active: 'saved.js' } }, lastProject: 'p', recent: ['p'] }, version: 1 };
    await fs.writeFile('.tide/tabs.json', JSON.stringify(saved));
    const readFile = fs.readFile.bind(fs);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = jest.spyOn(fs, 'readFile').mockImplementationOnce(async (p: string) => {
      await gate;
      return readFile(p);
    });
    const heard: string[] = [];
    const off = onStateFileReadable((name) => heard.push(name));
    const tabs = createTabsStore(createFsStorage(fs, { readTimeoutMs: 10 }));
    await hydrated(tabs, 1000);
    expect(tabs.getState().byProject).toEqual({});
    tabs.getState().openTab('q', 'new.js');
    await flush();
    // Not saved over the file it couldn't read.
    expect(JSON.parse(await readFile('.tide/tabs.json'))).toEqual(saved);

    slow.mockRestore();
    release();
    for (let i = 0; i < 10 && !tabs.getState().byProject.p; i++) await flush();
    off();
    expect(heard).toEqual(['tabs']);
    expect(tabs.getState().byProject.p.open).toEqual(['saved.js']);
    // Saving works again.
    tabs.getState().openTab('p', 'b.js');
    await flush();
    await flush();
    expect(JSON.parse(await readFile('.tide/tabs.json')).state.byProject.p.open).toEqual(['saved.js', 'b.js']);
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

  it('stops a store that did not load from saving its defaults over the file', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fs = createMemoryFs();
    const saved = JSON.stringify({ state: { n: 5 }, version: 0 });
    await fs.writeFile('.tide/m.json', saved);
    const store = createStore<{ n: number }>()(
      persist(() => ({ n: 0 }), {
        name: 'm',
        version: 1,
        storage: createJSONStorage(() => createFsStorage(fs)),
        migrate: () => {
          throw new Error('bad migration');
        },
      }),
    );
    await hydrated(store, 10);
    expect(store.persist.hasHydrated()).toBe(false);
    store.setState({ n: 1 });
    await flush();
    expect(await fs.readFile('.tide/m.json')).toBe(saved);
    warn.mockRestore();
  });

  it("doesn't wait the full timeout again for a store that already timed out", async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createStore<{ n: number }>()(
      persist(() => ({ n: 0 }), {
        name: 'never',
        storage: createJSONStorage(() => ({ getItem: () => new Promise<string | null>(() => undefined), setItem: async () => undefined, removeItem: async () => undefined })),
      }),
    );
    await hydrated(store, 20);
    const started = Date.now();
    await hydrated(store, 5_000);
    expect(Date.now() - started).toBeLessThan(1000);
    warn.mockRestore();
  });

  it('resolves as soon as the store has hydrated', async () => {
    const tabs = createTabsStore(createFsStorage(createMemoryFs()));
    await expect(hydrated(tabs, 60_000)).resolves.toBeUndefined();
  });
});

describe('allLoaded (L6: the splash waits for every start-up task)', () => {
  it('waits for the slow tasks even when one rejects early', async () => {
    const onError = jest.fn();
    let finishTabs!: () => void;
    const tabs = new Promise<void>((r) => (finishTabs = r));
    let done = false;
    const all = allLoaded([Promise.reject(new Error('listProjects failed')), tabs], onError).then(() => (done = true));
    await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'listProjects failed' }));
    expect(done).toBe(false);
    finishTabs();
    await expect(all).resolves.toBe(true);
  });
});
