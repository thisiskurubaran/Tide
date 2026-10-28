import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';

export interface RemoteSettings {
  // Base URL of the Tide server, e.g. http://192.168.1.20:8787
  url: string;
  token: string;
}

// Both values live in the Keychain (Keystore on Android): the token is a
// credential, and the URL is useless without it.
const URL_KEY = 'tide.remote.url';
const TOKEN_KEY = 'tide.remote.token';

export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function validateSettings(s: RemoteSettings): string | null {
  if (!s.url) return 'Enter the server URL';
  try {
    new URL(s.url);
  } catch {
    return 'The server URL is not valid';
  }
  if (s.token.length < 16) return 'The token is at least 16 characters';
  return null;
}

interface RemoteSettingsState {
  settings: RemoteSettings | null;
  loaded: boolean;
  load(): Promise<void>;
  save(settings: RemoteSettings): Promise<void>;
  clear(): Promise<void>;
}

export const remoteSettingsStore = createStore<RemoteSettingsState>()((set) => ({
  settings: null,
  loaded: false,
  async load() {
    const [url, token] = await Promise.all([SecureStore.getItemAsync(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
    set({ settings: url && token ? { url, token } : null, loaded: true });
  },
  async save(settings) {
    await SecureStore.setItemAsync(URL_KEY, settings.url);
    await SecureStore.setItemAsync(TOKEN_KEY, settings.token);
    set({ settings, loaded: true });
  },
  async clear() {
    await Promise.all([SecureStore.deleteItemAsync(URL_KEY), SecureStore.deleteItemAsync(TOKEN_KEY)]);
    set({ settings: null, loaded: true });
  },
}));

export const useRemoteSettings = <T>(selector: (s: RemoteSettingsState) => T) => useStore(remoteSettingsStore, selector);
