import { createStore, useStore } from 'zustand';

import { gitSettingsStore } from '../git/settings';
import { createGitHub, GitHub, User } from './api';

// The signed-in GitHub account. The token is the Git token in Settings → Git,
// so signing in once makes clone, push and the GitHub screens all work.
interface AccountState {
  user: User | null;
  checking: boolean;
  refresh(): Promise<void>;
  signIn(token: string): Promise<User>;
  signOut(): Promise<void>;
}

export const accountStore = createStore<AccountState>()((set) => ({
  user: null,
  checking: false,
  async refresh() {
    const { token } = gitSettingsStore.getState().settings;
    if (!token) return set({ user: null });
    set({ checking: true });
    try {
      set({ user: await createGitHub(token).user() });
    } catch {
      // Not a GitHub token (another host), or it was revoked.
      set({ user: null });
    } finally {
      set({ checking: false });
    }
  },
  async signIn(token) {
    const api = createGitHub(token);
    const user = await api.user();
    const current = gitSettingsStore.getState().settings;
    // Commits need a name and email; fill them in from the account if they're empty.
    // The noreply address keeps the real one private, as GitHub recommends.
    await gitSettingsStore.getState().save({
      name: current.name || user.name || user.login,
      email: current.email || `${user.id}+${user.login}@users.noreply.github.com`,
      token,
    });
    set({ user });
    return user;
  },
  async signOut() {
    const current = gitSettingsStore.getState().settings;
    await gitSettingsStore.getState().save({ ...current, token: '' });
    set({ user: null });
  },
}));

export const useAccount = <T>(selector: (s: AccountState) => T) => useStore(accountStore, selector);

export function github(): GitHub {
  const { token } = gitSettingsStore.getState().settings;
  if (!token) throw new Error('Sign in to GitHub first, in Settings → GitHub.');
  return createGitHub(token);
}
