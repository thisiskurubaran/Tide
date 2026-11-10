// @ts-check
// tide:mongo opens a MongoDB connection for the app's database viewer, on the
// bundled mongodb driver (pure JS).
//
//   TIDE_MONGO (env, JSON) holds the connection: hosts ("host:port,..."), srv
//   (true for mongodb+srv), options (the URI's query string), user, password,
//   database and ssl ("off" | "require" | "verify"). It's only in this
//   worker's environment; nothing is written to disk.
//
// Once connected it prints {"type":"ready","version":...}. Then each stdin
// line is a JSON request {id, op, ...} and gets one JSON reply line
// {id, ok: true, ...} or {id, ok: false, error}. Filters, sorts and documents
// travel as Extended JSON text, so ObjectIds, dates and the like survive.
// Through SSH, the app first forwards a local port with tide:ssh and points
// hosts at it.
'use strict';

const net = require('net');
const { MongoClient, EJSON } = require('./driver');

const config = JSON.parse(process.env.TIDE_MONGO || '{}');

function out(/** @type {object} */ obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function fail(/** @type {string} */ message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const where = String(config.hosts);
function friendly(/** @type {any} */ e) {
  const m = String((e && e.message) || e);
  if (/ECONNREFUSED/.test(m)) return `${where} refused the connection. Is the server running, and is the port right?`;
  if (/ENOTFOUND|EAI_AGAIN|querySrv/.test(m)) return `Can't find ${where}.`;
  if (/Server selection timed out|ETIMEDOUT/i.test(m)) return `${where} didn't answer. ${m}`;
  if (/Authentication failed/i.test(m)) return 'Authentication failed. Check the user, the password and the auth database (authSource).';
  if (/self[- ]signed|unable to verify|certificate/i.test(m)) return `${m}. Choose "Require" instead of "Verify" for TLS to accept the server's certificate.`;
  return m;
}

// Extended JSON text in, with plain numbers kept as plain numbers.
function parse(/** @type {unknown} */ text, /** @type {string} */ what) {
  if (text === undefined || text === null || String(text).trim() === '') return {};
  try {
    return EJSON.parse(String(text), { relaxed: true });
  } catch (e) {
    throw new Error(`The ${what} isn't valid JSON: ${/** @type {Error} */ (e).message}`);
  }
}

// Relaxed Extended JSON to read and edit, plus the _id in canonical form so the
// document can be found again whatever type its _id is.
const show = (/** @type {any} */ doc) => ({ json: EJSON.stringify(doc, undefined, 2, { relaxed: true }), id: doc && '_id' in doc ? EJSON.stringify(doc._id, { relaxed: false }) : null });

const LIMIT = 200;

/** @param {import('mongodb').MongoClient} client */
function handlers(client) {
  const coll = (/** @type {any} */ r) => client.db(String(r.db)).collection(String(r.coll));
  const byId = (/** @type {any} */ r) => {
    if (typeof r.docId !== 'string') throw new Error('This document has no _id to find it by.');
    return { _id: EJSON.parse(r.docId, { relaxed: false }) };
  };
  /** @type {Record<string, (r: any) => Promise<object>>} */
  const ops = {
    async databases() {
      try {
        const r = await client.db('admin').admin().listDatabases({ nameOnly: false });
        return { databases: r.databases.map((d) => ({ name: d.name, size: d.sizeOnDisk ?? null })) };
      } catch (e) {
        // Users limited to one database may not list them; show theirs.
        if (config.database) return { databases: [{ name: config.database, size: null }] };
        throw e;
      }
    },
    async collections(r) {
      const list = await client.db(String(r.db)).listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray();
      return { collections: list.map((c) => ({ name: c.name, kind: c.type === 'view' ? 'view' : 'collection' })).sort((a, b) => (a.name < b.name ? -1 : 1)) };
    },
    async find(r) {
      const filter = parse(r.filter, 'filter');
      const sort = parse(r.sort, 'sort');
      const limit = Math.min(LIMIT, Math.max(1, Number(r.limit) || 50));
      const docs = await coll(r).find(filter, { sort, skip: Math.max(0, Number(r.skip) || 0), limit }).toArray();
      return { docs: docs.map(show) };
    },
    async count(r) {
      const filter = parse(r.filter, 'filter');
      // The estimate is instant on big collections; a filter needs a real count.
      const n = Object.keys(filter).length ? await coll(r).countDocuments(filter) : await coll(r).estimatedDocumentCount();
      return { count: n };
    },
    async insert(r) {
      const doc = parse(r.doc, 'document');
      if (Array.isArray(doc) || typeof doc !== 'object') throw new Error('A document is a JSON object, like {"name": "Ada"}.');
      const res = await coll(r).insertOne(doc);
      return { insertedId: EJSON.stringify(res.insertedId, { relaxed: false }) };
    },
    async replace(r) {
      const doc = /** @type {any} */ (parse(r.doc, 'document'));
      const filter = byId(r);
      // The _id can't change; leaving it out keeps it.
      if ('_id' in doc && EJSON.stringify(doc._id, { relaxed: false }) !== r.docId) throw new Error("A document's _id can't be changed. Insert a copy and delete this one instead.");
      delete doc._id;
      const res = await coll(r).replaceOne(filter, doc);
      if (res.matchedCount === 0) throw new Error('That document is gone. Pull down to reload.');
      return {};
    },
    async delete(r) {
      const res = await coll(r).deleteOne(byId(r));
      if (res.deletedCount === 0) throw new Error('That document is gone. Pull down to reload.');
      return {};
    },
  };
  return ops;
}

// The driver keeps retrying a refused or unknown host until server selection
// times out; one plain connect says so at once. Slow networks are left to it.
function reachable(/** @type {string} */ hostPort) {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(hostPort.trim());
  if (!m) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: m[1], port: Number(m[2]) || 27017 });
    socket.setTimeout(5000, () => (socket.destroy(), resolve(undefined)));
    socket.once('connect', () => (socket.destroy(), resolve(undefined)));
    socket.once('error', (e) => (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(e.message) ? reject(e) : resolve(undefined)));
  });
}

function uri() {
  const db = config.database ? `/${encodeURIComponent(config.database)}` : '/';
  return `mongodb${config.srv ? '+srv' : ''}://${config.hosts}${db}${config.options ? `?${config.options}` : ''}`;
}

(async () => {
  if (!config.hosts) fail('usage: TIDE_MONGO with hosts');
  /** @type {import('mongodb').MongoClientOptions} */
  const options = {
    appName: 'Tide',
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
    // Without ICU the strict UTF-8 check can't run; strings still decode.
    enableUtf8Validation: false,
  };
  if (config.user) options.auth = { username: config.user, password: config.password || '' };
  if (config.ssl === 'require') Object.assign(options, { tls: true, tlsAllowInvalidCertificates: true, tlsAllowInvalidHostnames: true });
  else if (config.ssl === 'verify') options.tls = true;
  // Through a tunnel there's one local port, not the replica set's own hosts.
  if (config.direct) options.directConnection = true;

  let client;
  let version = 'MongoDB';
  try {
    if (!config.srv) await reachable(String(config.hosts).split(',')[0]);
    client = new MongoClient(uri(), options);
    await client.connect();
    const info = await client.db(config.database || 'admin').command({ buildInfo: 1 });
    if (info.version) version = `MongoDB ${info.version}`;
  } catch (e) {
    fail(friendly(e));
    return;
  }
  const ops = handlers(client);
  out({ type: 'ready', version });

  // Requests in flight, so closing waits for their replies.
  let inflight = Promise.resolve();
  const finish = () => inflight.then(() => client.close()).finally(() => process.exit(0));
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (/** @type {string} */ chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      /** @type {any} */
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      if (req.op === 'close') {
        finish();
        return;
      }
      const op = ops[req.op];
      if (!op) {
        out({ id: req.id, ok: false, error: `Unknown request ${req.op}.` });
        continue;
      }
      // The driver pools connections, so requests can overlap.
      const done = op(req).then(
        (result) => out({ ...result, id: req.id, ok: true }),
        (e) => out({ id: req.id, ok: false, error: friendly(e) }),
      );
      inflight = inflight.then(() => done);
    }
  });
  process.stdin.on('end', finish);
})();
