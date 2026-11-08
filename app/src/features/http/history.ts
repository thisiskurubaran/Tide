// The last responses each request got, kept so they can be looked at again,
// compared with the latest one, and sent again. Credentials are left out of
// what's stored:
// - header values with secret-like names (request and response);
// - in the URL, user:pass@ (the password, or the whole token@ when there's no
//   colon), query/fragment parameters with secret-like names, and path
//   segments that are secrets (webhook tokens, bot tokens, long random keys);
// - the request body is kept only when it can be redacted field by field:
//   JSON (fields with secret-like names, at any depth) and form-urlencoded
//   (the same, by field name). Any other body (raw text, XML, multipart,
//   binary) could hold a secret anywhere, so it isn't stored at all
//   (`bodyOmitted`);
// - in JSON (or form-urlencoded) response bodies, fields with secret-like
//   names (an OAuth token response's access_token).
// Redacted values are replaced with REDACTED, and resending an old request
// fills them (and an omitted body) in from the request as it is today, but
// only when it goes to the same scheme, host and port: today's credentials
// never go to another server. To another server, today's request is sent.
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

// Header names are checked like query and body fields (x-goog-api-key,
// dd-api-key, ocp-apim-subscription-key, ...), plus cookies.
export const isSecretHeader = (name: string) => SENSITIVE.test(name) || isSecretName(name);

export function redact(headers: [string, string][]): [string, string][] {
  return headers.map(([k, v]) => [k, isSecretHeader(k) ? REDACTED : v]);
}

// Query, fragment and body field names that hold credentials. Short generic
// names match exactly; the rest anywhere in the name (refresh_token, x-amz-signature).
const SECRET_EXACT = /^(key|auth|sig|code|pass|pwd|otp|session|sessionid|jwt|credentials?)$/;
const SECRET_PART = /token|secret|password|passwd|api[-_]?key|signature|authorization|private[-_]?key|access[-_]?key|client[-_]?secret|subscription[-_]?key/;
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

// A path segment that looks like a random key: 24+ characters, letters and
// digits mixed throughout (not a word, slug or CamelCase name), and not a
// UUID or a git object id, which are identifiers rather than secrets.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function looksRandom(segment: string): boolean {
  if (segment.length < 24 || !/^[A-Za-z0-9_.~-]+$/.test(segment)) return false;
  if (UUID.test(segment) || /^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(segment)) return false;
  if (!/[0-9]/.test(segment) || !/[A-Za-z]/.test(segment)) return false;
  // Words and numbers joined by separators (a slug, a dated file name).
  if (segment.split(/[-_.~]+/).every((part) => /^([A-Za-z]+|[0-9]+)$/.test(part))) return false;
  // Letters and digits interleaved throughout: random keys switch between
  // them every few characters; names (CamelCase2024) once or twice.
  const chars = segment.replace(/[^A-Za-z0-9]/g, '');
  let switches = 0;
  for (let i = 1; i < chars.length; i++) if (/[0-9]/.test(chars[i]) !== /[0-9]/.test(chars[i - 1])) switches++;
  return chars.length >= 20 && switches >= 4 && switches / chars.length >= 0.12;
}

// host[:port] and /path of the part after the scheme.
const splitRest = (rest: string) => {
  const slash = rest.indexOf('/');
  return slash < 0 ? { host: rest, path: '' } : { host: rest.slice(0, slash), path: rest.slice(slash) };
};

// Secret path segments: Slack and Discord webhook tokens, Telegram bot
// tokens, and long random-looking segments.
export function redactPath(host: string, path: string): string {
  const segs = path.split('/');
  const h = host.toLowerCase().replace(/:\d+$/, '');
  const services = segs.indexOf('services');
  const webhooks = segs.indexOf('webhooks');
  return segs
    .map((seg, i) => {
      if (!seg) return seg;
      // hooks.slack.com/services/T…/B…/<secret>
      if (h === 'hooks.slack.com' && services >= 0 && i >= services + 3) return REDACTED;
      // discord.com/api[/v10]/webhooks/<id>/<token>
      if (webhooks >= 0 && segs.includes('api') && i === webhooks + 2) return REDACTED;
      // api.telegram.org/bot<token>/method
      if (/^bot\d+:[A-Za-z0-9_-]+$/.test(seg)) return `bot${REDACTED}`;
      return looksRandom(seg) ? REDACTED : seg;
    })
    .join('/');
}

export function redactUrl(url: string): string {
  const parts = splitUrl(url);
  if (!parts) return url;
  const { host, path } = splitRest(parts.rest);
  parts.rest = host + redactPath(host, path);
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

const DEFAULT_PORTS: Record<string, string> = { 'http://': '80', 'https://': '443', 'ws://': '80', 'wss://': '443' };

// scheme://host:port, lowercased, with the default port filled in.
export function origin(url: string): string | null {
  const p = splitUrl(url.trim());
  if (!p) return null;
  const scheme = p.scheme.toLowerCase();
  const host = splitRest(p.rest).host.toLowerCase();
  const m = /^(.*?)(?::(\d+))?$/.exec(host)!;
  return `${scheme}${m[1]}:${m[2] ?? DEFAULT_PORTS[scheme] ?? ''}`;
}

export const sameOrigin = (a: string, b: string) => {
  const x = origin(a);
  return x !== null && x === origin(b);
};

// For sending an old request again: redacted URL parts take today's values.
// A redacted path segment can only come from today's URL with the same shape;
// otherwise today's URL is used.
export function restoreUrl(stored: string, current: string): string {
  if (!stored.includes(REDACTED)) return stored;
  const s = splitUrl(stored);
  const c = splitUrl(current);
  if (!s) return stored;
  const { host, path } = splitRest(s.rest);
  if (path.includes(REDACTED)) {
    const now = c ? splitRest(c.rest) : null;
    if (!now || now.host.toLowerCase() !== host.toLowerCase() || redactPath(now.host, now.path) !== path) return current;
    s.rest = host + now.path;
  }
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
    // A secret-named field is redacted whole, arrays and objects included.
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isSecretName(k) && v !== null ? REDACTED : redactJson(v)]));
  }
  return value;
}

// Fills REDACTED values in `stored` from the same place in `current`.
// Returns null if one can't be found there.
function restoreJson(stored: Json, current: Json | undefined): Json | null {
  if (stored === REDACTED) return current === undefined ? null : current;
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

const hasRedactions = (stored: StoredRequest) =>
  !!stored.bodyOmitted || stored.url.includes(REDACTED) || stored.body.includes(REDACTED) || stored.headers.some(([, v]) => v === REDACTED);

// An old request as it is sent again, credentials taken from today's request.
// Only to the same scheme, host and port as today's: anywhere else, filling
// in today's credentials would send them to a server they aren't for, so
// today's request is sent instead (an old one with nothing redacted goes as
// it was).
export function restoreRequest<T extends Pick<HttpRequest, 'method' | 'url' | 'headers' | 'body'>>(stored: StoredRequest, current: T): T {
  if (!sameOrigin(stored.url, current.url)) {
    if (hasRedactions(stored)) return current;
    return { ...current, method: stored.method, url: stored.url, headers: stored.headers, body: stored.body };
  }
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

// A response body as stored: JSON and form-urlencoded bodies lose their
// secret-named fields (a token endpoint's access_token); others are kept.
export function redactResponseBody(body: string, headers: [string, string][]): string {
  if (!body.trim()) return body;
  const json = parseJson(body);
  if (json !== undefined && typeof json === 'object' && json !== null) {
    const redacted = redactJson(json);
    if (JSON.stringify(redacted) === JSON.stringify(json)) return body;
    return JSON.stringify(redacted, null, body.includes('\n') ? 2 : undefined);
  }
  if (isForm(headers)) return redactPairs(body);
  // JSON cut short (a response over the size limit) doesn't parse: its
  // secret-named string and number fields are found by pattern instead.
  if (/^\s*[[{]/.test(body) || /json/i.test(header(headers, 'content-type'))) {
    return body.replace(/("((?:[^"\\]|\\.)*)"\s*:\s*)("(?:[^"\\]|\\.)*"?|-?[\d.eE+-]+)/g, (all, prefix: string, name: string) => (isSecretName(name) ? `${prefix}"${REDACTED}"` : all));
  }
  return body;
}

// What's stored of a request and its response (see the top of this file).
export function storedEntry(request: StoredRequest, response: HttpResponse, at: number): HistoryEntry {
  const redactedBody = redactResponseBody(response.body, response.headers);
  const body = redactedBody.length > MAX_STORED_BODY ? redactedBody.slice(0, MAX_STORED_BODY) : redactedBody;
  const requestBody = request.bodyOmitted ? { body: '', bodyOmitted: true as const } : redactBody(request.body, request.headers);
  return {
    at,
    request: {
      method: request.method,
      url: redactUrl(request.url),
      headers: redact(request.headers),
      ...requestBody,
    },
    response: { ...response, headers: redact(response.headers), body, truncated: response.truncated || body.length < redactedBody.length },
  };
}

const HISTORY_VERSION = 2;

// Version 1 kept response bodies as they came, and missed some headers, path
// tokens and nested secret fields: everything saved is redacted again.
export function migrateHistory(persisted: unknown, version: number): { entries: Record<string, HistoryEntry[]> } {
  const entries = (persisted as { entries?: unknown } | null)?.entries;
  if (!entries || typeof entries !== 'object') return { entries: {} };
  if (version >= HISTORY_VERSION) return { entries: entries as Record<string, HistoryEntry[]> };
  const out: Record<string, HistoryEntry[]> = {};
  for (const [key, list] of Object.entries(entries as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[key] = list.flatMap((e: HistoryEntry) => {
      try {
        return [storedEntry(e.request, e.response, e.at)];
      } catch {
        return [];
      }
    });
  }
  return { entries: out };
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
            const entry = storedEntry({ method: request.method, url: request.url, headers: request.headers, body: request.body }, response, at);
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
      { name: 'http-history', version: HISTORY_VERSION, storage: createJSONStorage(() => storage), migrate: (state, version) => migrateHistory(state, version) as unknown as HistoryState },
    ),
  );
}

export type HistoryStore = ReturnType<typeof createHistoryStore>;

const NONE: HistoryEntry[] = [];
export const useHistory = (store: HistoryStore, key: string) => useStore(store, (s) => s.entries[key] ?? NONE);
