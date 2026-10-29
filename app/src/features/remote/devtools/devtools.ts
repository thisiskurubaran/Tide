// What the preview's dev tools keep: console lines and network requests.
export type Level = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  key: number;
  kind: 'console' | 'input' | 'result';
  level: Level;
  text: string;
  source?: string;
  time: number;
}

export interface Request {
  id: string;
  method: string;
  url: string;
  type: 'fetch' | 'xhr';
  status: number | null;
  ms: number | null;
  size: number | null;
  contentType: string | null;
  error: string | null;
  time: number;
}

export interface DevtoolsState {
  console: ConsoleEntry[];
  requests: Request[];
  errors: number;
  url: string | null;
}

export type PageMessage =
  | { kind: 'console'; level: Level; text: string; source?: string; time: number }
  | { kind: 'net'; phase: 'start'; id: string; method: string; url: string; type: 'fetch' | 'xhr'; time: number }
  | { kind: 'net'; phase: 'end'; id: string; status: number; ms: number; size: number | null; contentType: string | null; time: number }
  | { kind: 'net'; phase: 'error'; id: string; ms: number; error: string; time: number }
  | { kind: 'eval'; id: number; ok: boolean; text: string; time: number }
  | { kind: 'page'; url: string; title: string; time: number };

export const MAX_ENTRIES = 500;

export const emptyDevtools = (): DevtoolsState => ({ console: [], requests: [], errors: 0, url: null });

let nextKey = 0;

export function parsePageMessage(raw: string): PageMessage | null {
  try {
    const msg = JSON.parse(raw);
    return msg && msg.__tide === true && typeof msg.kind === 'string' ? (msg as PageMessage) : null;
  } catch {
    return null;
  }
}

const capped = <T>(list: T[]) => (list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list);

export function addInput(s: DevtoolsState, code: string, time = Date.now()): DevtoolsState {
  return { ...s, console: capped([...s.console, { key: ++nextKey, kind: 'input', level: 'log', text: code, time }]) };
}

export function reduce(s: DevtoolsState, msg: PageMessage): DevtoolsState {
  switch (msg.kind) {
    case 'console': {
      const entry: ConsoleEntry = { key: ++nextKey, kind: 'console', level: msg.level, text: msg.text, source: msg.source, time: msg.time };
      return { ...s, console: capped([...s.console, entry]), errors: s.errors + (msg.level === 'error' ? 1 : 0) };
    }
    case 'eval': {
      const entry: ConsoleEntry = { key: ++nextKey, kind: 'result', level: msg.ok ? 'log' : 'error', text: msg.text, time: msg.time };
      return { ...s, console: capped([...s.console, entry]) };
    }
    case 'page':
      // A new page (navigation or reload) starts the network list afresh.
      return { ...s, url: msg.url, requests: [] };
    case 'net': {
      if (msg.phase === 'start') {
        const req: Request = { id: msg.id, method: msg.method, url: msg.url, type: msg.type, status: null, ms: null, size: null, contentType: null, error: null, time: msg.time };
        return { ...s, requests: capped([...s.requests, req]) };
      }
      const requests = s.requests.map((r) =>
        r.id !== msg.id
          ? r
          : msg.phase === 'end'
            ? { ...r, status: msg.status, ms: msg.ms, size: msg.size, contentType: msg.contentType }
            : { ...r, ms: msg.ms, error: msg.error },
      );
      return { ...s, requests };
    }
  }
}

export const clearConsole = (s: DevtoolsState): DevtoolsState => ({ ...s, console: [], errors: 0 });

// "http://127.0.0.1:3000/api/users?id=2" -> "/api/users?id=2" for the list.
export function shortUrl(url: string, page: string | null): string {
  try {
    const u = new URL(url);
    const p = page ? new URL(page) : null;
    return p && p.origin === u.origin ? `${u.pathname}${u.search}` : `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
