// Saved database servers. Like SSH servers, everything is in the Keychain: the
// list (no secrets) under one key, and each password under its own.
import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';

import type { ServerKind } from './dialect';

export interface DbConnection {
  id: string;
  name: string;
  kind: ServerKind;
  host: string;
  port: number;
  user: string;
  database: string;
  ssl: 'off' | 'require' | 'verify';
  // A saved SSH server to tunnel through; host and port are then as seen from it.
  sshHostId?: string;
}

export const DEFAULT_PORT: Record<ServerKind, number> = { postgres: 5432, mysql: 3306 };
export const KIND_LABEL: Record<ServerKind, string> = { postgres: 'PostgreSQL', mysql: 'MySQL' };

const LIST = 'tide.db.connections';
const passwordKey = (id: string) => `tide.db.password.${id}`;

interface ConnectionsState {
  connections: DbConnection[];
  loaded: boolean;
  load(): Promise<void>;
  // `password` undefined keeps the saved one; '' removes it.
  save(conn: DbConnection, password?: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export const connectionsStore = createStore<ConnectionsState>()((set, get) => ({
  connections: [],
  loaded: false,
  async load() {
    try {
      const v = await SecureStore.getItemAsync(LIST);
      set({ connections: v ? (JSON.parse(v) as DbConnection[]) : [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async save(conn, password) {
    const connections = [...get().connections.filter((c) => c.id !== conn.id), conn].sort((a, b) => a.name.localeCompare(b.name));
    await SecureStore.setItemAsync(LIST, JSON.stringify(connections));
    if (password) await SecureStore.setItemAsync(passwordKey(conn.id), password);
    else if (password === '') await SecureStore.deleteItemAsync(passwordKey(conn.id));
    set({ connections });
  },
  async remove(id) {
    const connections = get().connections.filter((c) => c.id !== id);
    await SecureStore.setItemAsync(LIST, JSON.stringify(connections));
    await SecureStore.deleteItemAsync(passwordKey(id));
    set({ connections });
  },
}));

let loading: Promise<void> | null = null;
export const useConnections = <T>(selector: (s: ConnectionsState) => T) => {
  if (!connectionsStore.getState().loaded && !loading) loading = connectionsStore.getState().load().finally(() => (loading = null));
  return useStore(connectionsStore, selector);
};

export const getPassword = (id: string) => SecureStore.getItemAsync(passwordKey(id)).catch(() => null);
