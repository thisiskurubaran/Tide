// Keychain entries that belong to a project (its secrets, its Render deploy
// hook). Keychain keys allow only letters, digits, ".", "-" and "_", so the
// project name goes in as the hex of its UTF-8 bytes: every name gets its own
// key ("my app" and "my_app" used to share one). The entries follow the
// project when it's renamed and go away when it's deleted.

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
}

// `projects` lists the projects there are, to tell whether an old key could
// belong to another one; such a key is left alone rather than handed to the
// wrong project.
export function createProjectKeychain(store: KeyStore, keys: ProjectKeys, projects: () => string[]) {
  const legacyOwnedBy = (project: string) => {
    const legacy = keys.legacy(project);
    return !projects().some((p) => p !== project && keys.legacy(p) === legacy);
  };

  async function read(project: string): Promise<string | null> {
    const value = await store.getItemAsync(keys.key(project));
    if (value !== null || !legacyOwnedBy(project)) return value;
    // Saved under the old key: moved on first read.
    const legacy = keys.legacy(project);
    if (legacy === keys.key(project)) return null;
    const old = await store.getItemAsync(legacy);
    if (old === null) return null;
    await store.setItemAsync(keys.key(project), old);
    await store.deleteItemAsync(legacy).catch(() => undefined);
    return old;
  }

  async function write(project: string, value: string | null): Promise<void> {
    if (value === null) await remove(project);
    else await store.setItemAsync(keys.key(project), value);
  }

  async function remove(project: string): Promise<void> {
    await store.deleteItemAsync(keys.key(project)).catch(() => undefined);
    if (legacyOwnedBy(project)) await store.deleteItemAsync(keys.legacy(project)).catch(() => undefined);
  }

  async function rename(from: string, to: string): Promise<void> {
    if (from === to) return;
    const value = await read(from);
    if (value === null) return;
    await store.setItemAsync(keys.key(to), value);
    await store.deleteItemAsync(keys.key(from)).catch(() => undefined);
  }

  return { read, write, remove, rename };
}

export type ProjectKeychain = ReturnType<typeof createProjectKeychain>;
