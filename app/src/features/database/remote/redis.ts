// Redis behind the database viewer: keys found with SCAN (never KEYS, which
// stalls a busy server), a value view per type, and a redis-cli style console.
import type { Runner } from '../../../runtime/runner';
import { connectLines } from './lines';

// Replies as tide:redis sends them: bulk strings as text, simple strings and
// errors as objects so they can be told apart.
export type Reply = string | number | null | Reply[] | { status: string } | { error: string };

export interface RedisClient {
  // One pipeline: a reply per command, errors included.
  call(cmds: string[][]): Promise<Reply[]>;
  close(): Promise<void>;
}

export interface RedisConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
  db?: number;
  ssl: 'off' | 'require' | 'verify';
}

export async function connectRedis(runner: Runner, config: RedisConfig): Promise<RedisClient & { version: string }> {
  const lines = await connectLines(runner, 'tide:redis', { TIDE_REDIS: JSON.stringify(config) });
  return {
    version: lines.version,
    call: async (cmds) => (await lines.request<{ replies: Reply[] }>({ cmds })).replies,
    close: () => lines.close(),
  };
}

export const isError = (r: Reply): r is { error: string } => !!r && typeof r === 'object' && !Array.isArray(r) && 'error' in r;

// The reply, or its error thrown.
const ok = (r: Reply) => {
  if (isError(r)) throw new Error(r.error);
  return r;
};

async function one(client: RedisClient, cmd: string[]) {
  return ok((await client.call([cmd]))[0]);
}

// A console line split into arguments the way redis-cli does: spaces separate,
// "double quotes" take \n \t \" \\ \xHH escapes, 'single quotes' only \'.
export function splitCommand(line: string): string[] {
  const args: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    let arg = '';
    while (i < line.length && !/\s/.test(line[i])) {
      const q = line[i];
      if (q !== '"' && q !== "'") {
        arg += line[i++];
        continue;
      }
      i++;
      let closed = false;
      while (i < line.length) {
        const c = line[i];
        if (c === q) {
          closed = true;
          i++;
          break;
        }
        if (c === '\\' && i + 1 < line.length) {
          const n = line[i + 1];
          if (q === "'") {
            arg += n === "'" ? "'" : `\\${n}`;
            i += 2;
            continue;
          }
          if (n === 'x' && /^[0-9a-f]{2}$/i.test(line.slice(i + 2, i + 4))) {
            arg += String.fromCharCode(parseInt(line.slice(i + 2, i + 4), 16));
            i += 4;
            continue;
          }
          arg += ({ n: '\n', r: '\r', t: '\t', b: '\b', a: '\x07' } as Record<string, string>)[n] ?? n;
          i += 2;
          continue;
        }
        arg += c;
        i++;
      }
      if (!closed) throw new Error('A quote isn’t closed.');
    }
    args.push(arg);
  }
  return args;
}

const quote = (s: string) => JSON.stringify(s);

// A reply as redis-cli prints it.
export function formatReply(r: Reply, indent = ''): string {
  if (r === null) return '(nil)';
  if (typeof r === 'number') return `(integer) ${r}`;
  if (typeof r === 'string') return quote(r);
  if (Array.isArray(r)) {
    if (!r.length) return '(empty array)';
    const width = String(r.length).length;
    return r
      .map((item, i) => {
        const n = `${String(i + 1).padStart(width)}) `;
        const body = formatReply(item, indent + ' '.repeat(n.length));
        return `${i === 0 ? '' : indent}${n}${body}`;
      })
      .join('\n');
  }
  if ('error' in r) return `(error) ${r.error}`;
  return r.status;
}

// Milliseconds left as a short duration; -1 is a key that never expires.
export function formatTtl(ms: number): string {
  if (ms === -1) return 'no expiry';
  if (ms < 0) return 'gone';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const [d, h, m] = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60)];
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export interface KeyInfo {
  key: string;
  type: string;
  // Milliseconds left, -1 for none.
  ttl: number;
}

// Keys a page at a time. SCAN can return few or no keys per call on a sparse
// match, so it's called until there are enough or the cursor comes back to 0.
export async function scanKeys(client: RedisClient, cursor: string, pattern: string, want = 100): Promise<{ keys: KeyInfo[]; cursor: string }> {
  const found: string[] = [];
  let c = cursor;
  for (let rounds = 0; rounds < 50; rounds++) {
    const [next, keys] = (await one(client, ['SCAN', c, 'MATCH', pattern || '*', 'COUNT', '500'])) as [string, string[]];
    found.push(...keys);
    c = next;
    if (c === '0' || found.length >= want) break;
  }
  // SCAN may repeat a key across calls.
  const keys = [...new Set(found)];
  if (!keys.length) return { keys: [], cursor: c };
  const replies = await client.call(keys.flatMap((k) => [['TYPE', k], ['PTTL', k]]));
  const infos = keys.map((key, i) => {
    const type = replies[i * 2];
    const ttl = replies[i * 2 + 1];
    return { key, type: type && typeof type === 'object' && 'status' in type ? type.status : 'none', ttl: typeof ttl === 'number' ? ttl : -1 };
  });
  // Keys that expired between the scan and now are left out.
  return { keys: infos.filter((k) => k.type !== 'none'), cursor: c };
}

export const STRING_LIMIT = 256 * 1024;
const ITEMS = 100;

export type Value =
  | { kind: 'string'; text: string; length: number; truncated: boolean }
  | {
      kind: 'items';
      columns: string[];
      rows: string[][];
      // How many there are in all.
      total: number;
      // Where the next page starts, or null at the end.
      cursor: string | null;
    }
  | { kind: 'other'; note: string };

const pairs = (flat: string[]) => {
  const out: string[][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

// A key's value, a page at a time for the collection types; `cursor` comes
// from the previous page.
export async function readValue(client: RedisClient, key: string, type: string, cursor: string | null = null): Promise<Value> {
  const start = cursor ?? '0';
  switch (type) {
    case 'string': {
      const [len, text] = (await client.call([['STRLEN', key], ['GETRANGE', key, '0', String(STRING_LIMIT - 1)]])).map(ok) as [number, string];
      return { kind: 'string', text, length: len, truncated: len > STRING_LIMIT };
    }
    case 'hash': {
      const [total, [next, flat]] = (await client.call([['HLEN', key], ['HSCAN', key, start, 'COUNT', String(ITEMS)]])).map(ok) as [number, [string, string[]]];
      return { kind: 'items', columns: ['field', 'value'], rows: pairs(flat), total, cursor: next === '0' ? null : next };
    }
    case 'set': {
      const [total, [next, members]] = (await client.call([['SCARD', key], ['SSCAN', key, start, 'COUNT', String(ITEMS)]])).map(ok) as [number, [string, string[]]];
      return { kind: 'items', columns: ['member'], rows: members.map((m) => [m]), total, cursor: next === '0' ? null : next };
    }
    case 'list': {
      const from = Number(start);
      const [total, items] = (await client.call([['LLEN', key], ['LRANGE', key, String(from), String(from + ITEMS - 1)]])).map(ok) as [number, string[]];
      const end = from + items.length;
      return { kind: 'items', columns: ['index', 'value'], rows: items.map((v, i) => [String(from + i), v]), total, cursor: end < total ? String(end) : null };
    }
    case 'zset': {
      const from = Number(start);
      const [total, flat] = (await client.call([['ZCARD', key], ['ZRANGE', key, String(from), String(from + ITEMS - 1), 'WITHSCORES']])).map(ok) as [number, string[]];
      const rows = pairs(flat);
      const end = from + rows.length;
      return { kind: 'items', columns: ['member', 'score'], rows, total, cursor: end < total ? String(end) : null };
    }
    case 'stream': {
      // From the last id shown, which XRANGE includes, so one extra is asked for and dropped.
      const [total, entries] = (await client.call([['XLEN', key], ['XRANGE', key, cursor ?? '-', '+', 'COUNT', String(cursor ? ITEMS + 1 : ITEMS)]])).map(ok) as [number, [string, string[]][]];
      const page = cursor ? entries.filter(([id]) => id !== cursor) : entries;
      const rows = page.map(([id, fields]) => [id, pairs(fields).map(([f, v]) => `${f}=${v}`).join('  ')]);
      const more = page.length >= ITEMS;
      return { kind: 'items', columns: ['id', 'fields'], rows, total, cursor: more ? page[page.length - 1][0] : null };
    }
    default:
      return { kind: 'other', note: `${type} values can be read and changed in the console.` };
  }
}

// Replaces a string value, keeping the key's expiry.
export async function setString(client: RedisClient, key: string, text: string): Promise<void> {
  const ttl = (await one(client, ['PTTL', key])) as number;
  ok((await client.call(ttl > 0 ? [['SET', key, text, 'PX', String(ttl)]] : [['SET', key, text]]))[0]);
}

export async function deleteKey(client: RedisClient, key: string): Promise<void> {
  if ((await one(client, ['DEL', key])) === 0) throw new Error('That key is gone. Pull down to reload.');
}

// How many databases the server has (CONFIG may be off on hosted Redis, where
// it's usually 16) and how many keys each holds.
export async function listDatabases(client: RedisClient): Promise<{ count: number; keys: Record<number, number> }> {
  const [config, info] = await client.call([['CONFIG', 'GET', 'databases'], ['INFO', 'keyspace']]);
  const n = Array.isArray(config) ? Number(config[1]) : NaN;
  const keys: Record<number, number> = {};
  const re = /^db(\d+):keys=(\d+)/gm;
  let m;
  while (typeof info === 'string' && (m = re.exec(info))) keys[Number(m[1])] = Number(m[2]);
  return { count: Number.isInteger(n) && n > 0 ? n : 16, keys };
}

export async function selectDb(client: RedisClient, db: number): Promise<void> {
  await one(client, ['SELECT', String(db)]);
}

// A console line: its reply, and the database it switched to if it was SELECT.
export async function runCommand(client: RedisClient, line: string): Promise<{ reply: Reply; db?: number }> {
  const args = splitCommand(line);
  if (!args.length) return { reply: { status: '' } };
  const reply = (await client.call([args]))[0];
  const db = /^select$/i.test(args[0]) && !isError(reply) ? Number(args[1]) : undefined;
  return { reply, ...(db === undefined ? {} : { db }) };
}
