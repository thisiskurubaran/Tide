import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';

export interface SshHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: 'password' | 'key';
  keyId?: string;
  // SHA256 fingerprint of the server's host key, saved the first time (trust on first use).
  fingerprint?: string;
  // Another saved server to connect through (a jump host / bastion).
  jumpId?: string;
}

export interface SshKey {
  id: string;
  name: string;
  publicKey: string;
}

// Everything is in the Keychain: the lists (no secrets) under one key each,
// and every password and private key under its own.
const HOSTS = 'tide.ssh.hosts';
const KEYS = 'tide.ssh.keys';
const passwordKey = (id: string) => `tide.ssh.password.${id}`;
const privateKeyKey = (id: string) => `tide.ssh.privatekey.${id}`;
const passphraseKey = (id: string) => `tide.ssh.passphrase.${id}`;

interface SshState {
  hosts: SshHost[];
  keys: SshKey[];
  loaded: boolean;
  load(): Promise<void>;
  saveHost(host: SshHost, password?: string): Promise<void>;
  removeHost(id: string): Promise<void>;
  trustHost(id: string, fingerprint: string | undefined): Promise<void>;
  addKey(key: SshKey, privateKey: string, passphrase?: string): Promise<void>;
  removeKey(id: string): Promise<void>;
}

const read = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const v = await SecureStore.getItemAsync(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const sshStore = createStore<SshState>()((set, get) => ({
  hosts: [],
  keys: [],
  loaded: false,
  async load() {
    set({ hosts: await read<SshHost[]>(HOSTS, []), keys: await read<SshKey[]>(KEYS, []), loaded: true });
  },
  async saveHost(host, password) {
    const hosts = [...get().hosts.filter((h) => h.id !== host.id), host].sort((a, b) => a.name.localeCompare(b.name));
    await SecureStore.setItemAsync(HOSTS, JSON.stringify(hosts));
    if (password !== undefined) {
      if (password) await SecureStore.setItemAsync(passwordKey(host.id), password);
      else await SecureStore.deleteItemAsync(passwordKey(host.id));
    }
    set({ hosts });
  },
  async removeHost(id) {
    const hosts = get().hosts.filter((h) => h.id !== id);
    await SecureStore.setItemAsync(HOSTS, JSON.stringify(hosts));
    await SecureStore.deleteItemAsync(passwordKey(id));
    set({ hosts });
  },
  async trustHost(id, fingerprint) {
    const host = get().hosts.find((h) => h.id === id);
    if (host) await get().saveHost({ ...host, fingerprint });
  },
  async addKey(key, privateKey, passphrase) {
    await SecureStore.setItemAsync(privateKeyKey(key.id), privateKey);
    if (passphrase) await SecureStore.setItemAsync(passphraseKey(key.id), passphrase);
    const keys = [...get().keys.filter((k) => k.id !== key.id), key];
    await SecureStore.setItemAsync(KEYS, JSON.stringify(keys));
    set({ keys });
  },
  async removeKey(id) {
    const keys = get().keys.filter((k) => k.id !== id);
    await SecureStore.setItemAsync(KEYS, JSON.stringify(keys));
    await SecureStore.deleteItemAsync(privateKeyKey(id));
    await SecureStore.deleteItemAsync(passphraseKey(id));
    set({ keys });
  },
}));

// Loads the saved servers and keys the first time any SSH screen needs them.
export const useSsh = <T>(selector: (s: SshState) => T) => {
  if (!sshStore.getState().loaded && !loading) loading = sshStore.getState().load().finally(() => (loading = null));
  return useStore(sshStore, selector);
};
let loading: Promise<void> | null = null;

// What tide:ssh needs to connect, secrets included. Only ever passed in a run's environment.
// A jump host's settings ride along under `jump` (one level; its own jump is ignored).
export async function connectionConfig(host: SshHost, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const jumpHost = host.jumpId ? sshStore.getState().hosts.find((h) => h.id === host.jumpId) : undefined;
  if (host.jumpId && !jumpHost) throw new Error('The server to connect through was removed. Pick another in this server’s settings.');
  const jump = jumpHost ? await connectionConfig({ ...jumpHost, jumpId: undefined }) : undefined;
  const base = { host: host.host, port: host.port, username: host.username, fingerprint: host.fingerprint, ...(jump ? { jump } : {}), ...extra };
  if (host.auth === 'key') {
    if (!host.keyId) throw new Error('Choose a key for this host.');
    const privateKey = await SecureStore.getItemAsync(privateKeyKey(host.keyId));
    if (!privateKey) throw new Error('The key for this host is missing. Choose another in its settings.');
    return { ...base, privateKey, passphrase: (await SecureStore.getItemAsync(passphraseKey(host.keyId))) ?? undefined };
  }
  return { ...base, password: (await SecureStore.getItemAsync(passwordKey(host.id))) ?? '' };
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Saves a host key reported on first connection, on the server or its jump host.
export const rememberKey = (host: SshHost, fingerprint: string, which: 'server' | 'jump') =>
  sshStore.getState().trustHost(which === 'jump' && host.jumpId ? host.jumpId : host.id, fingerprint);

export interface Forward {
  id: string;
  hostId: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: string;
  stop(): void;
}

// Port forwards that are running, for the SSH screen (not saved; they end with the app).
export const forwardsStore = createStore<{ forwards: Forward[] }>(() => ({ forwards: [] }));
export const useForwards = () => useStore(forwardsStore, (s) => s.forwards);
