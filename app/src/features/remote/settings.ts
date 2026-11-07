import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';

export interface RemoteSettings {
  // Base URL of the Tide server, e.g. https://tide.example.com or http://192.168.1.20:8787
  url: string;
  token: string;
}

// Both values live in the Keychain (Keystore on Android): the token is a
// credential, and the URL is useless without it.
const URL_KEY = 'tide.remote.url';
const TOKEN_KEY = 'tide.remote.token';

// A URL typed without a scheme gets https://, since the token and every synced
// file travel over it. An explicit http:// is kept (a server on the LAN), and
// saved settings always carry their scheme, so this never changes them.
export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Hosts where plain http:// stays off the internet: this device, private LAN
// ranges (RFC 1918, link-local, IPv6 ULA), mDNS names, and 100.64.0.0/10
// (carrier-grade NAT, which Tailscale uses inside its encrypted tunnel).
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(':')) return h === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(h) || /^fe[89ab][0-9a-f]?:/.test(h);
  return false;
}

// True for an http:// URL whose host may be on the internet: the token and the
// project's files would be readable by anyone on the way. The settings screen warns.
// Parsed by hand: React Native's URL has no full WHATWG parser.
export function isInsecureUrl(url: string): boolean {
  const m = /^http:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(url.trim());
  return !!m && !!m[1] && !isLocalHost(m[1]);
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
