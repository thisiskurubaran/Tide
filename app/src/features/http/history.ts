// The last responses each request got, kept so they can be looked at again,
// compared with the latest one, and sent again. Credentials are left out of
// what's stored:
// - header values with secret-like names (request and response);
// - in the URL, user:pass@ (the password, or the whole token@ when there's no
//   colon) and query/fragment parameters with secret-like names;
// - the request body is kept only when it can be redacted field by field:
//   JSON (fields with secret-like names, at any depth) and form-urlencoded
//   (the same, by field name). Any other body (raw text, XML, multipart,
//   binary) could hold a secret anywhere, so it isn't stored at all
//   (`bodyOmitted`).
// Redacted values are replaced with REDACTED, and resending an old request
// fills them (and an omitted body) in from the request as it is today.
import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { HttpRequest, HttpResponse } from './http';

export type StoredRequest = Pick<HttpRequest, 'method' | 'url' | 'headers' | 'body'> & {
  // The body wasn't stored (see above); resending uses today's.
  bodyOmitted?: boolean;
};

export interface HistoryEntry {
  at: number;
  request: StoredRequest;
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

// Query, fragment and body field names that hold credentials. Short generic
// names match exactly; the rest anywhere in the name (refresh_token, x-amz-signature).
const SECRET_EXACT = /^(key|auth|sig|code|pass|pwd|otp|session|sessionid|jwt|credentials?)$/;
const SECRET_PART = /token|secret|password|passwd|api[-_]?key|signature|authorization|private[-_]?key|access[-_]?key|client[-_]?secret/;
// Named like a secret, but never one.
const NOT_SECRET = /^(token_type|token_type_hint|response_type|code_challenge_method)$/;
export const isSecretName = (name: string) => {
  const n = name.toLowerCase();
  return !NOT_SECRET.test(n) && (SECRET_EXACT.test(n) || SECRET_PART.test(n));
};

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

// a=1&b=2, with each secret-named value replaced. Pairs keep their order and spelling.
function redactPairs(text: string): string {
  return text
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      return isSecretName(decode(pair.slice(0, eq))) ? `${pair.slice(0, eq)}=${REDACTED}` : pair;
    })
    .join('&');
}

// Redacted values in `stored` pairs take the value of the same name in
// `current`; a redacted pair with no current value is dropped.
function restorePairs(stored: string, current: string): string {
  const now = new Map<string, string>();
  for (const pair of current.split('&')) {
    const eq = pair.indexOf('=');
    if (eq >= 0 && !now.has(decode(pair.slice(0, eq)))) now.set(decode(pair.slice(0, eq)), pair.slice(eq + 1));
  }
  return stored
    .split('&')
    .flatMap((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0 || pair.slice(eq + 1) !== REDACTED) return [pair];
      const value = now.get(decode(pair.slice(0, eq)));
      return value === undefined ? [] : [`${pair.slice(0, eq)}=${value}`];
    })
    .join('&');
}

// scheme://userinfo@host/path?query#fragment, split without URL (React
// Native's is incomplete) and without normalizing anything.
const URL_PARTS = /^([a-z][a-z0-9+.-]*:\/\/)?(?:([^/?#@]*)@)?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/is;

interface UrlParts {
  scheme: string;
  userinfo?: string;
  rest: string;
  query?: string;
  fragment?: string;
}

function splitUrl(url: string): UrlParts | null {
  const m = URL_PARTS.exec(url);
  if (!m) return null;
  const [, scheme = '', userinfo, rest = '', query, fragment] = m;
  return { scheme, userinfo, rest, query, fragment };
}

const joinUrl = ({ scheme, userinfo, rest, query, fragment }: UrlParts) =>
  `${scheme}${userinfo !== undefined ? `${userinfo}@` : ''}${rest}${query !== undefined ? `?${query}` : ''}${fragment !== undefined ? `#${fragment}` : ''}`;

export function redactUrl(url: string): string {
  const parts = splitUrl(url);
  if (!parts) return url;
  if (parts.userinfo !== undefined && parts.userinfo !== '') {
    const colon = parts.userinfo.indexOf(':');
    // user:pass@ keeps the user; a bare token@ is all secret.
    parts.userinfo = colon >= 0 ? `${parts.userinfo.slice(0, colon)}:${REDACTED}` : REDACTED;
  }
  if (parts.query !== undefined) parts.query = redactPairs(parts.query);
  // OAuth puts tokens in the fragment (#access_token=...).
  if (parts.fragment !== undefined && parts.fragment.includes('=')) parts.fragment = redactPairs(parts.fragment);
  return joinUrl(parts);
}

// For sending an old request again: redacted URL parts take today's values.
export function restoreUrl(stored: string, current: string): string {
  if (!stored.includes(REDACTED)) return stored;
  const s = splitUrl(stored);
  const c = splitUrl(current);
  if (!s) return stored;
  if (s.userinfo?.includes(REDACTED)) s.userinfo = c?.userinfo && c.rest.split('/')[0] === s.rest.split('/')[0] ? c.userinfo : undefined;
  if (s.query !== undefined) s.query = restorePairs(s.query, c?.query ?? '');
  if (s.fragment?.includes(REDACTED)) s.fragment = restorePairs(s.fragment, c?.fragment ?? '');
  return joinUrl(s);
}

const header = (headers: [string, string][], name: string) => headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? '';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function redactJson(value: Json): Json {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSecretName(k) && v !== null && typeof v !== 'object' ? REDACTED : redactJson(v)]));
  }
  return value;
}

// Fills REDACTED values in `stored` from the same place in `current`.
// Returns null if one can't be found there.
function restoreJson(stored: Json, current: Json | undefined): Json | null {
  if (stored === REDACTED) return current === undefined || (current !== null && typeof current === 'object') ? null : current;
  if (Array.isArray(stored)) {
    const out: Json[] = [];
    for (let i = 0; i < stored.length; i++) {
      const v = restoreJson(stored[i], Array.isArray(current) ? current[i] : undefined);
      if (v === null && stored[i] !== null) return null;
      out.push(v);
    }
    return out;
  }
  if (stored && typeof stored === 'object') {
    const cur = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(stored)) {
      const r = restoreJson(v, cur[k]);
      if (r === null && v !== null) return null;
      out[k] = r;
    }
    return out;
  }
  return stored;
}

const parseJson = (text: string): Json | undefined => {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
};

const isForm = (headers: [string, string][]) => /application\/x-www-form-urlencoded/i.test(header(headers, 'content-type'));

// What of a request body is stored: see the top of this file.
export function redactBody(body: string, headers: [string, string][]): { body: string; bodyOmitted?: true } {
  if (!body.trim()) return { body };
  const json = parseJson(body);
  if (json !== undefined && typeof json === 'object' && json !== null) {
    const redacted = redactJson(json);
    if (JSON.stringify(redacted) === JSON.stringify(json)) return { body };
    return { body: JSON.stringify(redacted, null, body.includes('\n') ? 2 : undefined) };
  }
  if (isForm(headers)) return { body: redactPairs(body) };
  return { body: '', bodyOmitted: true };
}

// The body to send again: today's if it wasn't stored or its redacted fields
// can't all be filled in from today's.
export function restoreBody(stored: StoredRequest, current: Pick<HttpRequest, 'body' | 'headers'>): string {
  if (stored.bodyOmitted) return current.body;
  if (!stored.body.includes(REDACTED)) return stored.body;
  const json = parseJson(stored.body);
  if (json !== undefined) {
    const filled = restoreJson(json, parseJson(current.body));
    return filled === null ? current.body : JSON.stringify(filled, null, stored.body.includes('\n') ? 2 : undefined);
  }
  const filled = restorePairs(stored.body, current.body);
  return filled.split('&').length === stored.body.split('&').length ? filled : current.body;
}

// An old request as it is sent again, credentials taken from today's request.
export function restoreRequest<T extends Pick<HttpRequest, 'method' | 'url' | 'headers' | 'body'>>(stored: StoredRequest, current: T): T {
  return {
    ...current,
    method: stored.method,
    url: restoreUrl(stored.url, current.url),
    headers: restoreHeaders(stored.headers, current.headers),
    body: restoreBody(stored, current),
  };
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
              request: {
                method: request.method,
                url: redactUrl(request.url),
                headers: redact(request.headers),
                ...redactBody(request.body, request.headers),
              },
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
