// Keychain entries that belong to a project (its secrets, its Render deploy
// hook). Keychain keys allow only letters, digits, ".", "-" and "_", so the
// project name goes in as the hex of its UTF-8 bytes: every name gets its own
// key ("my app" and "my_app" used to share one). The entries follow the
// project when it's renamed and go away when it's deleted.

import { Identify, identityReliable } from '../agent/projectIdentity';

// Hex of the name's UTF-8 bytes.
export function hexName(name: string): string {
  let out = '';
  for (const part of encodeURIComponent(name).match(/%[0-9A-F]{2}|[^%]/gi) ?? []) {
    out += part.length === 3 ? part.slice(1).toLowerCase() : part.charCodeAt(0).toString(16).padStart(2, '0');
  }
  return out;
}

export interface KeyStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface ProjectKeys {
  // Where the entry is kept now.
  key(project: string): string;
  // Where older versions kept it (a lossy encoding several names can share).
  legacy(project: string): string;
  // Where the list of projects with an entry is kept, so entries of projects
  // whose folder is gone can be found and removed (the Keychain can't be listed).
  index?: string;
}

export interface KeychainOptions {
  // The project folder's identity (agent/projectIdentity.ts). Where it's
  // reliable (iOS), an entry records it, and a different project made later
  // under the same name doesn't get the entry. null: the folder is gone.
  identify?: Identify;
}

// The identity recorded with an entry.
const ownerKey = (key: string) => `${key}.owner`;

// `projects` lists the projects there are, or null until they've loaded. It
// tells whether an old key could belong to another one: until the list has
// loaded, or when another project's name maps to the same old key, the old
// key is left alone rather than handed to the wrong project.
export function createProjectKeychain(store: KeyStore, keys: ProjectKeys, projects: () => string[] | null, { identify }: KeychainOptions = {}) {
  const legacyOwnedBy = (project: string) => {
    const list = projects();
    if (!list) return false;
    const legacy = keys.legacy(project);
    return !list.some((p) => p !== project && keys.legacy(p) === legacy);
  };
  const trusted = () => identityReliable(identify);
  // The folder's identity: '' unknown or not trusted here, null gone.
  const known = async (project: string): Promise<string | null> => {
    if (!identify) return '';
    const id = await identify(project).catch(() => '');
    return id === null ? null : trusted() ? id : '';
  };

  // Index updates run one after another so none is lost.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(fn);
    queue = next;
    return next;
  };
  const readIndex = async (): Promise<string[]> => {
    if (!keys.index) return [];
    try {
      const list = JSON.parse((await store.getItemAsync(keys.index)) ?? '[]');
      return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
    } catch {
      return [];
    }
  };
  const updateIndex = (change: (names: Set<string>) => void) =>
    serial(async () => {
      if (!keys.index) return;
      const names = new Set(await readIndex());
      const before = JSON.stringify([...names]);
      change(names);
      if (JSON.stringify([...names]) === before) return;
      if (names.size) await store.setItemAsync(keys.index, JSON.stringify([...names]));
      else await store.deleteItemAsync(keys.index);
    }).catch(() => undefined);

  // Records the project's identity with its entry, the first time it's known.
  const claim = async (project: string, id: string) => {
    if (id) await store.setItemAsync(ownerKey(keys.key(project)), id).catch(() => undefined);
  };

  async function read(project: string): Promise<string | null> {
    const value = await readOwn(project);
    if (value !== null) await updateIndex((n) => n.add(project));
    return value;
  }

  async function readOwn(project: string): Promise<string | null> {
    const value = await store.getItemAsync(keys.key(project));
    if (value !== null) {
      const id = await known(project);
      if (id === null) return null;
      const owner = await store.getItemAsync(ownerKey(keys.key(project))).catch(() => null);
      if (owner && id && owner !== id) {
        // Another project now has this name: the entry was the old one's.
        await remove(project);
        return null;
      }
      if (!owner) await claim(project, id);
      return value;
    }
    if (!legacyOwnedBy(project)) return null;
    // Saved under the old key: moved on first read.
    const legacy = keys.legacy(project);
    if (legacy === keys.key(project)) return null;
    const old = await store.getItemAsync(legacy);
    if (old === null) return null;
    await store.setItemAsync(keys.key(project), old);
    await store.deleteItemAsync(legacy).catch(() => undefined);
    const id = await known(project);
    if (id) await claim(project, id);
    return old;
  }

  async function write(project: string, value: string | null): Promise<void> {
    if (value === null) return remove(project);
    await store.setItemAsync(keys.key(project), value);
    const id = await known(project);
    if (id) await claim(project, id);
    else await store.deleteItemAsync(ownerKey(keys.key(project))).catch(() => undefined);
    await updateIndex((n) => n.add(project));
  }

  async function remove(project: string): Promise<void> {
    await store.deleteItemAsync(keys.key(project)).catch(() => undefined);
    await store.deleteItemAsync(ownerKey(keys.key(project))).catch(() => undefined);
    if (legacyOwnedBy(project)) await store.deleteItemAsync(keys.legacy(project)).catch(() => undefined);
    await updateIndex((n) => n.delete(project));
  }

  async function rename(from: string, to: string): Promise<void> {
    if (from === to) return;
    const value = await store.getItemAsync(keys.key(from)).catch(() => null);
    const owner = await store.getItemAsync(ownerKey(keys.key(from))).catch(() => null);
    const moved = value ?? (await readOwn(from).catch(() => null));
    if (moved === null) return;
    await store.setItemAsync(keys.key(to), moved);
    if (owner) await store.setItemAsync(ownerKey(keys.key(to)), owner);
    else await store.deleteItemAsync(ownerKey(keys.key(to))).catch(() => undefined);
    await store.deleteItemAsync(keys.key(from)).catch(() => undefined);
    await store.deleteItemAsync(ownerKey(keys.key(from))).catch(() => undefined);
    await updateIndex((n) => {
      n.delete(from);
      n.add(to);
    });
  }

  // At start-up, once the projects have loaded: entries of projects whose
  // folder is gone (deleted in the Files app) are removed, so a project made
  // later under that name doesn't inherit them.
  async function reconcile(): Promise<void> {
    const list = projects();
    if (!list) return;
    for (const project of await readIndex()) {
      const gone = identify ? (await known(project)) === null : !list.includes(project);
      if (gone) await remove(project);
    }
  }

  return { read, write, remove, rename, reconcile };
}

export type ProjectKeychain = ReturnType<typeof createProjectKeychain>;
