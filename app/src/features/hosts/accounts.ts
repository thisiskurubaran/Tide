// Signed-in GitLab and Bitbucket accounts. The list is in the
// Keychain without secrets, and each token under its own key; tokens are kept
// in memory once loaded so git runs can use them.
import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';

import type { GitHost, HostKind } from './api';
import { createBitbucket } from './bitbucket';
import { createGitLab } from './gitlab';

export interface HostAccount {
  id: string;
  kind: HostKind;
  // GitLab's address: https://gitlab.com or your own instance.
  baseUrl: string;
  // Bitbucket signs in with the Atlassian account's email.
  email?: string;
  username: string;
  name: string;
}

export const HOST_LABEL: Record<HostKind, string> = { gitlab: 'GitLab', bitbucket: 'Bitbucket' };

const LIST = 'tide.hosts.accounts';
const tokenKey = (id: string) => `tide.hosts.token.${id}`;

export function hostApi(account: Pick<HostAccount, 'kind' | 'baseUrl' | 'email'>, token: string, fetchImpl?: typeof fetch): GitHost {
  return account.kind === 'gitlab' ? createGitLab(account.baseUrl, token, fetchImpl) : createBitbucket(account.email ?? '', token, fetchImpl);
}

interface AccountsState {
  accounts: HostAccount[];
  tokens: Record<string, string>;
  loaded: boolean;
  load(): Promise<void>;
  // Checks the token by asking who it belongs to, then saves the account.
  add(account: Omit<HostAccount, 'id' | 'username' | 'name'>, token: string): Promise<HostAccount>;
  remove(id: string): Promise<void>;
}

export const accountsStore = createStore<AccountsState>()((set, get) => ({
  accounts: [],
  tokens: {},
  loaded: false,
  async load() {
    try {
      const v = await SecureStore.getItemAsync(LIST);
      const accounts = v ? (JSON.parse(v) as HostAccount[]) : [];
      const tokens = Object.fromEntries(await Promise.all(accounts.map(async (a) => [a.id, (await SecureStore.getItemAsync(tokenKey(a.id))) ?? ''])));
      set({ accounts, tokens, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async add(partial, token) {
    const baseUrl = partial.kind === 'gitlab' ? (partial.baseUrl.trim() || 'https://gitlab.com').replace(/\/+$/, '') : 'https://bitbucket.org';
    if (partial.kind === 'gitlab' && !/^https:\/\//.test(baseUrl)) throw new Error('The GitLab address starts with https://.');
    const me = await hostApi({ ...partial, baseUrl }, token.trim()).user();
    const account: HostAccount = { ...partial, baseUrl, id: `${partial.kind}-${Date.now().toString(36)}`, username: me.username, name: me.name };
    const accounts = [...get().accounts, account];
    await SecureStore.setItemAsync(tokenKey(account.id), token.trim());
    await SecureStore.setItemAsync(LIST, JSON.stringify(accounts));
    set({ accounts, tokens: { ...get().tokens, [account.id]: token.trim() } });
    return account;
  },
  async remove(id) {
    const accounts = get().accounts.filter((a) => a.id !== id);
    await SecureStore.setItemAsync(LIST, JSON.stringify(accounts));
    await SecureStore.deleteItemAsync(tokenKey(id));
    const { [id]: _, ...tokens } = get().tokens;
    set({ accounts, tokens });
  },
}));

export const useAccounts = <T>(selector: (s: AccountsState) => T) => useStore(accountsStore, selector);

export function apiFor(accountId: string): GitHost {
  const { accounts, tokens } = accountsStore.getState();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('That account was removed.');
  return hostApi(account, tokens[account.id] ?? '');
}

// What tide:git sends for each host's remotes: GitLab takes the token with the
// user "oauth2"; Bitbucket API tokens use "x-bitbucket-api-token-auth".
export function gitCredentials(): Record<string, { username: string; password: string }> {
  const { accounts, tokens } = accountsStore.getState();
  const out: Record<string, { username: string; password: string }> = {};
  for (const a of accounts) {
    const token = tokens[a.id];
    if (!token) continue;
    const host = /^https?:\/\/([^/]+)/.exec(a.baseUrl)?.[1];
    if (host) out[host] = a.kind === 'gitlab' ? { username: 'oauth2', password: token } : { username: 'x-bitbucket-api-token-auth', password: token };
  }
  return out;
}
