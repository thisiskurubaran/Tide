// MongoDB behind the database viewer: databases, collections and documents as
// Extended JSON, filtered and sorted with JSON the way mongosh takes it.
import type { Runner } from '../../../runtime/runner';
import { connectLines, LineClient } from './lines';

export interface MongoConfig {
  // host:port, or several comma-separated; a name to look up for srv.
  hosts: string;
  srv?: boolean;
  options?: string;
  user?: string;
  password?: string;
  database?: string;
  ssl: 'off' | 'require' | 'verify';
  // Through an SSH tunnel: talk to the one forwarded port, not the replica set.
  direct?: boolean;
}

export function connectMongo(runner: Runner, config: MongoConfig): Promise<LineClient & { version: string }> {
  return connectLines(runner, 'tide:mongo', { TIDE_MONGO: JSON.stringify(config) });
}

// What a connection string holds, for when one is pasted as the host.
export interface MongoUri {
  hosts: string;
  srv: boolean;
  user: string;
  password: string;
  database: string;
  options: string;
}

export function parseMongoUri(text: string): MongoUri | null {
  const m = /^mongodb(\+srv)?:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/.exec(text.trim());
  if (!m) return null;
  const decode = (s: string | undefined) => {
    try {
      return decodeURIComponent(s ?? '');
    } catch {
      return s ?? '';
    }
  };
  return { srv: !!m[1], user: decode(m[2]), password: decode(m[3]), hosts: m[4], database: decode(m[5]), options: m[6] ?? '' };
}

const HELPERS: Record<string, (arg: string | number | undefined) => object> = {
  ObjectId: (a) => ({ $oid: String(a ?? '') }),
  ISODate: (a) => ({ $date: a === undefined ? new Date().toISOString() : String(a) }),
  Date: (a) => ({ $date: a === undefined ? new Date().toISOString() : typeof a === 'number' ? new Date(a).toISOString() : String(a) }),
  NumberLong: (a) => ({ $numberLong: String(a ?? 0) }),
  NumberInt: (a) => ({ $numberInt: String(a ?? 0) }),
  NumberDecimal: (a) => ({ $numberDecimal: String(a ?? 0) }),
  UUID: (a) => ({ $uuid: String(a ?? '') }),
};

// mongosh-style JSON as Extended JSON: unquoted keys, 'single quotes' and
// ObjectId("..."), ISODate("..."), NumberLong(...) and friends. Strict JSON
// passes through unchanged.
export function shellToEjson(text: string): string {
  let out = '';
  let i = 0;
  const readString = () => {
    const q = text[i++];
    let s = '';
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\\' && i + 1 < text.length) {
        const n = text[i + 1];
        // A JSON escape stays as it is; \' just becomes '.
        s += n === "'" ? "'" : n === '"' ? '\\"' : `\\${n}`;
        i += 2;
        continue;
      }
      s += text[i] === '"' ? '\\"' : text[i];
      i++;
    }
    if (i >= text.length) throw new Error('A quote isn’t closed.');
    i++;
    return `"${s}"`;
  };
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      out += readString();
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let word = '';
      while (i < text.length && /[\w$]/.test(text[i])) word += text[i++];
      const save = i;
      skipSpace();
      // new Date(...) is Date(...).
      if (word === 'new' && /[A-Z]/.test(text[i] ?? '')) continue;
      if (text[i] === '(' && HELPERS[word]) {
        i++;
        skipSpace();
        let arg: string | number | undefined;
        if (text[i] === '"' || text[i] === "'") arg = JSON.parse(readString());
        else {
          let num = '';
          while (i < text.length && /[-+\d.eE]/.test(text[i])) num += text[i++];
          if (num) arg = Number(num);
        }
        skipSpace();
        if (text[i] !== ')') throw new Error(`${word}(…) takes one value.`);
        i++;
        out += JSON.stringify(HELPERS[word](arg));
        continue;
      }
      if (text[i] === ':') {
        out += JSON.stringify(word);
        continue;
      }
      i = save;
      out += word;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export interface MongoDoc {
  // Relaxed Extended JSON, indented.
  json: string;
  // The _id as canonical Extended JSON, to find the document again.
  id: string | null;
}

export const DOC_PAGE = 50;

// Requests to tide:mongo; filters, sorts and documents are mongosh-style or
// Extended JSON text.
export function mongoBrowser(client: LineClient) {
  const ejson = (text: string) => (text.trim() ? shellToEjson(text) : '');
  return {
    databases: async () => (await client.request<{ databases: { name: string; size: number | null }[] }>({ op: 'databases' })).databases,
    collections: async (db: string) => (await client.request<{ collections: { name: string; kind: 'collection' | 'view' }[] }>({ op: 'collections', db })).collections,
    find: async (db: string, coll: string, q: { filter: string; sort: string; skip: number }) =>
      (await client.request<{ docs: MongoDoc[] }>({ op: 'find', db, coll, filter: ejson(q.filter), sort: ejson(q.sort), skip: q.skip, limit: DOC_PAGE })).docs,
    count: async (db: string, coll: string, filter: string) => (await client.request<{ count: number }>({ op: 'count', db, coll, filter: ejson(filter) })).count,
    insert: async (db: string, coll: string, doc: string) => (await client.request<{ insertedId: string }>({ op: 'insert', db, coll, doc: ejson(doc) })).insertedId,
    replace: async (db: string, coll: string, id: string, doc: string) => {
      await client.request({ op: 'replace', db, coll, docId: id, doc: ejson(doc) });
    },
    remove: async (db: string, coll: string, id: string) => {
      await client.request({ op: 'delete', db, coll, docId: id });
    },
    close: () => client.close(),
  };
}

export type MongoBrowser = ReturnType<typeof mongoBrowser>;
