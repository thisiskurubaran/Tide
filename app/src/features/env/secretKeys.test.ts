import type { Identify } from '../agent/projectIdentity';
import { createProjectKeychain, hexName, KeyStore } from './secretKeys';

function memoryKeychain() {
  const items = new Map<string, string>();
  const store: KeyStore = {
    getItemAsync: async (k) => items.get(k) ?? null,
    setItemAsync: async (k, v) => {
      // The Keychain only takes these characters in a key.
      if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`invalid key ${k}`);
      items.set(k, v);
    },
    deleteItemAsync: async (k) => void items.delete(k),
  };
  return { items, store };
}

// The keys env/store.ts uses.
const keys = {
  key: (project: string) => `tide.secrets.env.${hexName(project)}`,
  legacy: (project: string) => `tide.env.${encodeURIComponent(project).replace(/[^A-Za-z0-9.-]/g, '_')}`,
  index: 'tide.secrets.env.index',
};

describe('project secrets in the Keychain', () => {
  it('gives every project name its own key', () => {
    expect(hexName('my app')).toBe('6d7920617070');
    expect(hexName('a b')).not.toBe(hexName('a_20b'));
    expect(hexName('my app')).not.toBe(hexName('my_app'));
    expect(hexName('café')).toBe('636166c3a9');
    expect(keys.key('a b')).not.toBe(keys.key('a_20b'));
    // Names the old key mangled into one.
    expect(keys.legacy('a b')).toBe(keys.legacy('a_20b'));
  });

  it('keeps colliding names apart', async () => {
    const { store } = memoryKeychain();
    const projects = ['a b', 'a_20b'];
    const chain = createProjectKeychain(store, keys, () => projects);
    await chain.write('a b', 'one');
    await chain.write('a_20b', 'two');
    expect(await chain.read('a b')).toBe('one');
    expect(await chain.read('a_20b')).toBe('two');
  });

  it('moves a value from the old key on first read', async () => {
    const { items, store } = memoryKeychain();
    items.set(keys.legacy('my app'), '{"TOKEN":"x"}');
    const chain = createProjectKeychain(store, keys, () => ['my app']);
    expect(await chain.read('my app')).toBe('{"TOKEN":"x"}');
    expect(items.has(keys.legacy('my app'))).toBe(false);
    expect(items.get(keys.key('my app'))).toBe('{"TOKEN":"x"}');
  });

  it("leaves an old key alone when another project could own it", async () => {
    const { items, store } = memoryKeychain();
    items.set(keys.legacy('a b'), 'secret');
    const chain = createProjectKeychain(store, keys, () => ['a b', 'a_20b']);
    expect(await chain.read('a_20b')).toBeNull();
    expect(items.get(keys.legacy('a b'))).toBe('secret');
  });

  it('follows a rename and goes with a delete', async () => {
    const { items, store } = memoryKeychain();
    const projects = ['web'];
    const chain = createProjectKeychain(store, keys, () => projects);
    await chain.write('web', 'v');
    await chain.rename('web', 'site');
    projects[0] = 'site';
    expect(await chain.read('web')).toBeNull();
    expect(await chain.read('site')).toBe('v');
    // An old-style entry for the deleted project goes too.
    items.set(keys.legacy('site'), 'old');
    await chain.remove('site');
    expect(items.size).toBe(0);
  });

  it('waits for the project list before moving an old key, and never hands an ambiguous one out', async () => {
    const { items, store } = memoryKeychain();
    items.set(keys.legacy('a b'), 'secret');
    let projects: string[] | null = null;
    const chain = createProjectKeychain(store, keys, () => projects);
    // Before projects load, nobody can tell whether "a_20b" exists too.
    expect(await chain.read('a b')).toBeNull();
    await chain.remove('a b');
    expect(items.get(keys.legacy('a b'))).toBe('secret');
    // Loaded, and ambiguous: still left alone, for either name.
    projects = ['a b', 'a_20b'];
    expect(await chain.read('a b')).toBeNull();
    expect(await chain.read('a_20b')).toBeNull();
    expect(items.get(keys.legacy('a b'))).toBe('secret');
    // Loaded, and only one project could own it: moved.
    projects = ['a b'];
    expect(await chain.read('a b')).toBe('secret');
  });

  describe('tied to the project folder', () => {
    const ids = new Map<string, string>();
    const identify: Identify = async (p) => ids.get(p) ?? null;
    beforeEach(() => ids.clear());

    it("aren't inherited by a project made again under a deleted one's name (identity reliable)", async () => {
      const { store } = memoryKeychain();
      ids.set('web', 'born-1');
      const chain = createProjectKeychain(store, keys, () => ['web'], { identify });
      await chain.write('web', 'secret');
      expect(await chain.read('web')).toBe('secret');
      // Deleted in the Files app and made again: a new folder.
      ids.set('web', 'born-2');
      expect(await chain.read('web')).toBeNull();
      ids.set('web', 'born-1');
      expect(await chain.read('web')).toBeNull();
    });

    it('keep their identity across a rename', async () => {
      const { store } = memoryKeychain();
      ids.set('web', 'born-1');
      const chain = createProjectKeychain(store, keys, () => ['site'], { identify });
      await chain.write('web', 'secret');
      ids.delete('web');
      ids.set('site', 'born-1');
      await chain.rename('web', 'site');
      expect(await chain.read('site')).toBe('secret');
    });

    it('ignore identities where they are not reliable (Android)', async () => {
      const { store } = memoryKeychain();
      const unreliable: Identify = Object.assign(async (p: string) => ids.get(p) ?? null, { reliable: () => false });
      ids.set('web', 'mtime-1');
      const chain = createProjectKeychain(store, keys, () => ['web'], { identify: unreliable });
      await chain.write('web', 'secret');
      ids.set('web', 'mtime-2');
      expect(await chain.read('web')).toBe('secret');
    });

    it("are removed at start-up when the project's folder is gone, everywhere", async () => {
      const { items, store } = memoryKeychain();
      const unreliable: Identify = Object.assign(async (p: string) => ids.get(p) ?? null, { reliable: () => false });
      ids.set('web', '');
      ids.set('api', '');
      let projects: string[] | null = ['web', 'api'];
      const chain = createProjectKeychain(store, keys, () => projects, { identify: unreliable });
      await chain.write('web', 'w');
      await chain.write('api', 'a');
      // The app closes; "web" is deleted in the Files app.
      ids.delete('web');
      projects = null;
      await chain.reconcile();
      expect(items.has(keys.key('web'))).toBe(true);
      projects = ['api'];
      await chain.reconcile();
      expect(items.has(keys.key('web'))).toBe(false);
      expect(items.get(keys.key('api'))).toBe('a');
      // A project made later under the name starts with nothing.
      ids.set('web', '');
      expect(await chain.read('web')).toBeNull();
    });
  });
});
