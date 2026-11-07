/**
 * @jest-environment node
 */
/// <reference types="node" />
// Connection strings, mongosh-style JSON, and everything the viewer does
// through tide:mongo: against a small fake server that speaks MongoDB's wire
// protocol (so the real driver is exercised), and against a real one when
// given, e.g. TIDE_TEST_MONGO='{"hosts":"127.0.0.1:27017","user":"root","password":"pw","options":"authSource=admin"}'.
// The fake also runs with Intl and strict UTF-8 decoding taken away, as on
// nodejs-mobile.
import { BSON, EJSON } from 'bson';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { serverFromForm } from './form';
import { spawnLines } from './lines.testutil';
import { DOC_PAGE, mongoBrowser, parseMongoUri, shellToEjson } from './mongo';

describe('parseMongoUri', () => {
  it('reads standard and srv connection strings', () => {
    expect(parseMongoUri('mongodb+srv://ada:p%40ss@cluster0.abc.mongodb.net/shop?retryWrites=true&w=majority')).toEqual({
      srv: true,
      user: 'ada',
      password: 'p@ss',
      hosts: 'cluster0.abc.mongodb.net',
      database: 'shop',
      options: 'retryWrites=true&w=majority',
    });
    expect(parseMongoUri('mongodb://a:27017,b:27018/?replicaSet=rs0')).toEqual({ srv: false, user: '', password: '', hosts: 'a:27017,b:27018', database: '', options: 'replicaSet=rs0' });
    expect(parseMongoUri('mongodb://localhost')).toMatchObject({ hosts: 'localhost', database: '' });
    expect(parseMongoUri('postgres://x')).toBeNull();
  });

  it('turns a pasted string into a saved connection with the password apart', () => {
    const v = { name: '', host: 'mongodb://ada:pw@db.example.com:27020/shop?authSource=admin', port: '', user: '', password: '', database: '', options: 'tls=false&authSource=other', ssl: 'off', ssh: '' };
    expect(serverFromForm('mongo', v, 'id1', false)).toEqual({
      conn: { id: 'id1', name: 'shop', kind: 'mongo', host: 'db.example.com', port: 27020, user: 'ada', database: 'shop', ssl: 'off', options: 'authSource=other&tls=false' },
      password: 'pw',
    });
    const srv = serverFromForm('mongo', { ...v, host: 'mongodb+srv://c0.x.mongodb.net', options: '' }, 'id2', true);
    expect(srv.conn).toMatchObject({ host: 'c0.x.mongodb.net', srv: true, port: 27017 });
    // Editing with an empty password keeps the saved one.
    expect(srv.password).toBeUndefined();
    expect(() => serverFromForm('mongo', { ...v, host: 'mongodb://' }, 'x', false)).toThrow('connection string');
    expect(() => serverFromForm('redis', { ...v, host: 'h', database: 'two' }, 'x', false)).toThrow('number');
    expect(serverFromForm('redis', { ...v, host: 'cache', database: '2' }, 'x', false).conn).toMatchObject({ kind: 'redis', port: 6379, database: '2', user: '' });
  });
});

describe('shellToEjson', () => {
  it('takes mongosh syntax and leaves JSON alone', () => {
    const strict = '{"a": {"$gt": 1}, "s": "it\'s: ObjectId(\\"x\\")"}';
    expect(shellToEjson(strict)).toBe(strict);
    expect(JSON.parse(shellToEjson("{ _id: ObjectId('64b7f0c2a1b2c3d4e5f60718'), name: 'Ada \"L\"', at: ISODate(\"2024-01-02T03:04:05Z\"), n: NumberLong(5), new: true }"))).toEqual({
      _id: { $oid: '64b7f0c2a1b2c3d4e5f60718' },
      name: 'Ada "L"',
      at: { $date: '2024-01-02T03:04:05Z' },
      n: { $numberLong: '5' },
      new: true,
    });
    expect(JSON.parse(shellToEjson('{ at: { $lt: new Date(0) } }'))).toEqual({ at: { $lt: { $date: '1970-01-01T00:00:00.000Z' } } });
    expect(() => shellToEjson("{ a: 'open }")).toThrow('quote');
  });
});

// A MongoDB server in memory: just enough of the protocol and commands for
// the driver and the viewer. Filters match top-level fields by value, with $gt / $lt.
function fakeMongo(): Promise<{ port: number; close(): void }> {
  const dbs = new Map<string, Map<string, any[]>>();
  const coll = (db: string, name: string) => {
    if (!dbs.has(db)) dbs.set(db, new Map());
    const d = dbs.get(db)!;
    if (!d.has(name)) d.set(name, []);
    return d.get(name)!;
  };
  const same = (a: unknown, b: unknown) => EJSON.stringify(a as any, { relaxed: false }) === EJSON.stringify(b as any, { relaxed: false });
  const value = (v: any) => (v instanceof Date ? v.getTime() : typeof v === 'object' && v && 'toNumber' in v ? v.toNumber() : v);
  const matches = (doc: any, filter: any) =>
    Object.entries(filter ?? {}).every(([k, want]: [string, any]) => {
      if (want && typeof want === 'object' && ('$gt' in want || '$lt' in want)) {
        return ('$gt' in want ? value(doc[k]) > value(want.$gt) : true) && ('$lt' in want ? value(doc[k]) < value(want.$lt) : true);
      }
      return same(doc[k], want);
    });
  const cursor = (ns: string, docs: any[]) => ({ cursor: { id: BSON.Long.fromNumber(0), ns, firstBatch: docs }, ok: 1 });

  const run = (cmd: any): any => {
    const name = Object.keys(cmd)[0];
    const db = cmd.$db ?? 'admin';
    switch (name.toLowerCase()) {
      case 'hello':
      case 'ismaster':
        return { ismaster: true, isWritablePrimary: true, helloOk: true, maxWireVersion: 17, minWireVersion: 0, maxBsonObjectSize: 16777216, maxMessageSizeBytes: 48000000, maxWriteBatchSize: 100000, localTime: new Date(), connectionId: 1, ok: 1 };
      case 'buildinfo':
        return { version: '7.0.0-fake', ok: 1 };
      case 'ping':
      case 'endsessions':
        return { ok: 1 };
      case 'listdatabases':
        return { databases: [...dbs.keys()].map((n) => ({ name: n, sizeOnDisk: 4096, empty: false })), ok: 1 };
      case 'listcollections':
        return cursor(`${db}.$cmd.listCollections`, [...(dbs.get(db)?.keys() ?? [])].map((n) => ({ name: n, type: 'collection' })));
      case 'find': {
        let docs = coll(db, cmd.find).filter((d) => matches(d, cmd.filter));
        const sort = Object.entries(cmd.sort ?? {}) as [string, number][];
        docs = [...docs].sort((a, b) => {
          for (const [k, dir] of sort) if (value(a[k]) !== value(b[k])) return (value(a[k]) < value(b[k]) ? -1 : 1) * dir;
          return 0;
        });
        return cursor(`${db}.${cmd.find}`, docs.slice(cmd.skip ?? 0, (cmd.skip ?? 0) + (cmd.limit ?? docs.length)));
      }
      case 'count':
        return { n: coll(db, cmd.count).filter((d) => matches(d, cmd.query)).length, ok: 1 };
      case 'aggregate': {
        // countDocuments: [$match, $group {n: $sum 1}].
        const match = cmd.pipeline.find((s: any) => s.$match)?.$match;
        const n = coll(db, cmd.aggregate).filter((d) => matches(d, match)).length;
        return cursor(`${db}.${cmd.aggregate}`, n ? [{ _id: 1, n }] : []);
      }
      case 'insert':
        for (const d of cmd.documents) coll(db, cmd.insert).push(d);
        return { n: cmd.documents.length, ok: 1 };
      case 'update': {
        let n = 0;
        for (const u of cmd.updates) {
          const docs = coll(db, cmd.update);
          const i = docs.findIndex((d) => matches(d, u.q));
          if (i >= 0) {
            docs[i] = { _id: docs[i]._id, ...u.u };
            n++;
          }
        }
        return { n, nModified: n, ok: 1 };
      }
      case 'delete': {
        let n = 0;
        for (const del of cmd.deletes) {
          const docs = coll(db, cmd.delete);
          const i = docs.findIndex((d) => matches(d, del.q));
          if (i >= 0) {
            docs.splice(i, 1);
            n++;
          }
        }
        return { n, ok: 1 };
      }
      default:
        return { ok: 0, errmsg: `no such command: '${name}'`, code: 59, codeName: 'CommandNotFound' };
    }
  };

  const reply = (requestId: number, opCode: number, body: Buffer) => {
    const head = Buffer.alloc(16);
    head.writeInt32LE(16 + body.length, 0);
    head.writeInt32LE(0, 4);
    head.writeInt32LE(requestId, 8);
    head.writeInt32LE(opCode, 12);
    return Buffer.concat([head, body]);
  };
  const handle = (msg: Buffer): Buffer => {
    const requestId = msg.readInt32LE(4);
    const opCode = msg.readInt32LE(12);
    if (opCode === 2004) {
      // OP_QUERY, used for the first hello: flags, name, skip, return, query.
      const nameEnd = msg.indexOf(0, 20);
      const cmd = BSON.deserialize(msg.subarray(nameEnd + 9));
      const doc = BSON.serialize(run(cmd));
      const body = Buffer.alloc(20);
      body.writeInt32LE(1, 16);
      return reply(requestId, 1, Buffer.concat([body, doc]));
    }
    // OP_MSG: flags, then a body section and maybe document sequences.
    let at = 20;
    let cmd: any = {};
    while (at < msg.length) {
      const kind = msg[at++];
      if (kind === 0) {
        const len = msg.readInt32LE(at);
        cmd = { ...BSON.deserialize(msg.subarray(at, at + len)), ...cmd };
        at += len;
      } else {
        const len = msg.readInt32LE(at);
        const end = at + len;
        const idEnd = msg.indexOf(0, at + 4);
        const field = msg.toString('utf8', at + 4, idEnd);
        const docs = [];
        for (let p = idEnd + 1; p < end; ) {
          const dl = msg.readInt32LE(p);
          docs.push(BSON.deserialize(msg.subarray(p, p + dl)));
          p += dl;
        }
        cmd[field] = docs;
        at = end;
      }
    }
    const body = Buffer.concat([Buffer.alloc(4), Buffer.from([0]), BSON.serialize(run(cmd))]);
    return reply(requestId, 2013, body);
  };

  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4 && buf.length >= buf.readInt32LE(0)) {
        const len = buf.readInt32LE(0);
        socket.write(handle(buf.subarray(0, len)));
        buf = buf.subarray(len);
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const sockets = new Set<net.Socket>();
      server.on('connection', (s) => (sockets.add(s), s.on('close', () => sockets.delete(s))));
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => (server.close(), sockets.forEach((s) => s.destroy())) });
    }),
  );
}

// Node as nodejs-mobile builds it: no Intl, and no fatal UTF-8 decoding.
const noIntl = path.join(os.tmpdir(), 'tide-no-intl.js');
fs.writeFileSync(
  noIntl,
  `delete globalThis.Intl;
const TD = globalThis.TextDecoder;
globalThis.TextDecoder = class extends TD { constructor(e, o) { if (o && o.fatal) throw new Error('ERR_NO_ICU: "fatal" option is not supported'); super(e, o); } };
`,
);

async function exercise(config: object, nodeArgs: string[] = []) {
  const lines = await spawnLines('mongo', { TIDE_MONGO: JSON.stringify({ ssl: 'off', ...config }) }, nodeArgs);
  const m = mongoBrowser(lines);
  const db = `tide_test_${Date.now().toString(36)}`;
  try {
    expect(lines.version).toMatch(/^MongoDB \d/);
    // Inserting makes the collection; mongosh syntax and Extended JSON both go in.
    const id = await m.insert(db, 'people', "{ _id: ObjectId('64b7f0c2a1b2c3d4e5f60718'), name: 'Ada', born: ISODate('2015-12-10T00:00:00Z'), n: 0 }");
    expect(id).toBe('{"$oid":"64b7f0c2a1b2c3d4e5f60718"}');
    for (let i = 1; i <= DOC_PAGE + 5; i++) await m.insert(db, 'people', JSON.stringify({ name: `p${i}`, n: i, tags: ['x'] }));

    expect((await m.databases()).map((d) => d.name)).toContain(db);
    expect(await m.collections(db)).toEqual([{ name: 'people', kind: 'collection' }]);
    expect(await m.count(db, 'people', '')).toBe(DOC_PAGE + 6);
    expect(await m.count(db, 'people', '{ n: { $gt: 50 } }')).toBe(5);

    // Pages, sorted; dates and ObjectIds as Extended JSON.
    const first = await m.find(db, 'people', { filter: '', sort: '{ n: 1 }', skip: 0 });
    expect(first).toHaveLength(DOC_PAGE);
    expect(JSON.parse(first[0].json)).toEqual({ _id: { $oid: '64b7f0c2a1b2c3d4e5f60718' }, name: 'Ada', born: { $date: '2015-12-10T00:00:00Z' }, n: 0 });
    expect(first[0].json).toContain('\n  "name": "Ada"');
    const rest = await m.find(db, 'people', { filter: '', sort: '{ n: 1 }', skip: DOC_PAGE });
    expect(rest.map((d) => JSON.parse(d.json).n)).toEqual([50, 51, 52, 53, 54, 55]);
    const desc = await m.find(db, 'people', { filter: '{"n": {"$lt": 3}}', sort: '{"n": -1}', skip: 0 });
    expect(desc.map((d) => JSON.parse(d.json).n)).toEqual([2, 1, 0]);

    // Editing replaces the document but keeps its _id, whatever its type.
    const p1 = desc[1];
    await m.replace(db, 'people', p1.id!, '{ "name": "Grace", "n": 1 }');
    const edited = await m.find(db, 'people', { filter: '{ n: 1 }', sort: '', skip: 0 });
    expect(JSON.parse(edited[0].json)).toEqual({ _id: JSON.parse(p1.json)._id, name: 'Grace', n: 1 });
    await expect(m.replace(db, 'people', p1.id!, '{ "_id": 5, "n": 1 }')).rejects.toThrow("_id can't be changed");
    // The _id written back unchanged is fine.
    await m.replace(db, 'people', first[0].id!, first[0].json.replace('"Ada"', '"Ada L"'));
    expect(JSON.parse((await m.find(db, 'people', { filter: '{ n: 0 }', sort: '', skip: 0 }))[0].json).name).toBe('Ada L');

    await m.remove(db, 'people', p1.id!);
    await expect(m.remove(db, 'people', p1.id!)).rejects.toThrow('gone');
    await expect(m.replace(db, 'people', p1.id!, '{}')).rejects.toThrow('gone');
    expect(await m.count(db, 'people', '')).toBe(DOC_PAGE + 5);

    await expect(m.find(db, 'people', { filter: '{ n: ', sort: '', skip: 0 })).rejects.toThrow("filter isn't valid JSON");
    await expect(m.insert(db, 'people', '[1]')).rejects.toThrow('JSON object');
  } finally {
    await m.close();
  }
}

describe('through tide:mongo', () => {
  let fake: { port: number; close(): void };
  beforeAll(async () => {
    fake = await fakeMongo();
  });
  afterAll(() => fake.close());

  it('lists, pages, filters, sorts, counts, inserts, edits and deletes (fake server)', async () => {
    await exercise({ hosts: `127.0.0.1:${fake.port}` });
  }, 30000);

  it('works without Intl, as on nodejs-mobile (fake server)', async () => {
    await exercise({ hosts: `127.0.0.1:${fake.port}`, direct: true }, ['--require', noIntl]);
  }, 30000);

  it('says when nothing is listening', async () => {
    const closed = await fakeMongo();
    closed.close();
    await expect(spawnLines('mongo', { TIDE_MONGO: JSON.stringify({ hosts: `127.0.0.1:${closed.port}`, ssl: 'off' }) })).rejects.toThrow(/refused|didn't answer/);
  }, 15000);

  const real = process.env.TIDE_TEST_MONGO;
  (real ? it : it.skip)('does the same against a real server', async () => {
    await exercise(JSON.parse(real!));
  }, 60000);
});
