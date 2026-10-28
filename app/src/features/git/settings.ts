import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';

export interface GitSettings {
  name: string;
  email: string;
  // Personal access token for pushing and for private repositories.
  token: string;
}

const KEYS = { name: 'tide.git.name', email: 'tide.git.email', token: 'tide.git.token' } as const;
const EMPTY: GitSettings = { name: '', email: '', token: '' };

interface GitSettingsState {
  settings: GitSettings;
  load(): Promise<void>;
  save(settings: GitSettings): Promise<void>;
}

// All three live in the Keychain: the token is a credential, and keeping the
// identity next to it means one place to clear.
export const gitSettingsStore = createStore<GitSettingsState>()((set) => ({
  settings: EMPTY,
  async load() {
    const [name, email, token] = await Promise.all(Object.values(KEYS).map((k) => SecureStore.getItemAsync(k)));
    set({ settings: { name: name ?? '', email: email ?? '', token: token ?? '' } });
  },
  async save(settings) {
    for (const [field, key] of Object.entries(KEYS) as [keyof GitSettings, string][]) {
      const value = settings[field].trim();
      if (value) await SecureStore.setItemAsync(key, value);
      else await SecureStore.deleteItemAsync(key);
    }
    set({ settings });
  },
}));

export const useGitSettings = <T>(selector: (s: GitSettingsState) => T) => useStore(gitSettingsStore, selector);

// Environment for one git run; the supervisor never stores it.
export function gitEnv(): Record<string, string> {
  const { name, email, token } = gitSettingsStore.getState().settings;
  return { TIDE_GIT_NAME: name, TIDE_GIT_EMAIL: email, TIDE_GIT_TOKEN: token };
}
