// The last responses each request got, kept so they can be looked at again,
// compared with the latest one, and sent again. Credentials in request
// headers are left out of what's stored.
import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { HttpRequest, HttpResponse } from './http';

export interface HistoryEntry {
  at: number;
  request: Pick<HttpRequest, 'method' | 'url' | 'headers' | 'body'>;
  response: HttpResponse;
}

export const PER_REQUEST = 10;
const MAX_REQUESTS = 200;
// Big bodies are cut so the history file stays small.
export const MAX_STORED_BODY = 200_000;

const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$|token|secret|password/i;
export const REDACTED = '••••••';

export const historyKey = (project: string, path: string, request: string) => `${project}/${path}#${request}`;

export function redact(headers: [string, string][]): [string, string][] {
  return headers.map(([k, v]) => [k, SENSITIVE.test(k) ? REDACTED : v]);
}

// For sending an old request again: its redacted headers take today's values.
export function restoreHeaders(stored: [string, string][], current: [string, string][]): [string, string][] {
  return stored.flatMap(([k, v]): [string, string][] => {
    if (v !== REDACTED) return [[k, v]];
    const now = current.find(([c]) => c.toLowerCase() === k.toLowerCase());
    return now ? [[k, now[1]]] : [];
  });
}

interface HistoryState {
  entries: Record<string, HistoryEntry[]>;
  add(key: string, request: HistoryEntry['request'], response: HttpResponse, at?: number): void;
  clear(key: string): void;
}

export function createHistoryStore(storage: StateStorage) {
  return createStore<HistoryState>()(
    persist(
      (set) => ({
        entries: {},
        add: (key, request, response, at = Date.now()) =>
          set((s) => {
            const body = response.body.length > MAX_STORED_BODY ? response.body.slice(0, MAX_STORED_BODY) : response.body;
            const entry: HistoryEntry = {
              at,
              request: { ...request, headers: redact(request.headers) },
              response: { ...response, headers: redact(response.headers), body, truncated: response.truncated || body.length < response.body.length },
            };
            const entries = { ...s.entries, [key]: [entry, ...(s.entries[key] ?? [])].slice(0, PER_REQUEST) };
            // The requests used longest ago go first when there are too many.
            const keys = Object.keys(entries);
            if (keys.length > MAX_REQUESTS) {
              keys
                .sort((a, b) => entries[a][0].at - entries[b][0].at)
                .slice(0, keys.length - MAX_REQUESTS)
                .forEach((k) => delete entries[k]);
            }
            return { entries };
          }),
        clear: (key) =>
          set((s) => {
            const { [key]: _, ...entries } = s.entries;
            return { entries };
          }),
      }),
      { name: 'http-history', version: 1, storage: createJSONStorage(() => storage) },
    ),
  );
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;

const NONE: HistoryEntry[] = [];
export const useHistory = (store: HistoryStore, key: string) => useStore(store, (s) => s.entries[key] ?? NONE);
