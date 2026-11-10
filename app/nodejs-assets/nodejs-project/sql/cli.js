// @ts-check
// tide:sql opens a Postgres or MySQL connection for the app's database viewer, on
// the bundled pg and mysql2 drivers (pure JS).
//
//   TIDE_SQL (env, JSON) holds the connection: kind ("postgres" | "mysql"),
//   host, port, user, password, database, and ssl ("off" | "require" | "verify").
//   It's only in this worker's environment; nothing is written to disk.
//
// Once connected it prints {"type":"ready","version":...}. Then each stdin
// line is a JSON request {id, sql, params?} and gets one JSON reply line:
// {id, ok: true, columns, rows, rowCount, command} or {id, ok: false, error}.
// Values come back as text (or null), exactly as the server shows them, so they
// can be edited and sent back without changing type.
// Through SSH, the app first forwards a local port with tide:ssh and points
// host and port at it.
'use strict';

const { pg, mysql } = require('./drivers');

const config = JSON.parse(process.env.TIDE_SQL || '{}');

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const where = `${config.host}:${config.port}`;
function friendly(/** @type {any} */ e) {
  const m = String((e && e.message) || e);
  if (/ECONNREFUSED/.test(m)) return `${where} refused the connection. Is the server running, and is the port right?`;
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return `Can't find ${config.host}.`;
  if (/ETIMEDOUT|timeout/i.test(m)) return `${where} didn't answer.`;
  if (/self[- ]signed|unable to verify|certificate/i.test(m)) return `${m}. Choose "Require" instead of "Verify" for SSL to accept the server's certificate.`;
  return m;
}

const ssl = config.ssl === 'verify' ? { rejectUnauthorized: true } : config.ssl === 'require' ? { rejectUnauthorized: false } : undefined;

// Binary values as hex, the way both servers write them.
const hex = (/** @type {Buffer} */ b) => `0x${b.toString('hex')}`;
const text = (/** @type {unknown} */ v) => (v === null || v === undefined ? null : Buffer.isBuffer(v) ? hex(v) : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** @returns {Promise<{ query(sql: string, params: unknown[]): Promise<any>, version: string, close(): Promise<void> }>} */
async function connectPostgres() {
  const client = new pg.Client({
    host: config.host,
    port: Number(config.port) || 5432,
    user: config.user,
    password: config.password || undefined,
    database: config.database || undefined,
    ssl,
    connectionTimeoutMillis: 20000,
    // Every type as the server's text, untouched.
    types: { getTypeParser: () => (/** @type {string} */ v) => v },
  });
  client.on('error', (e) => fail(friendly(e)));
  await client.connect();
  const { rows } = await client.query('SHOW server_version');
  return {
    version: `PostgreSQL ${rows[0].server_version}`,
    async query(sql, params) {
      const r = await client.query({ text: sql, values: params, rowMode: 'array' });
      // Several statements give several results; the last one is shown.
      const last = Array.isArray(r) ? r[r.length - 1] : r;
      const columns = (last.fields || []).map((/** @type {any} */ f) => f.name);
      return {
        columns,
        rows: (last.rows || []).map((/** @type {unknown[]} */ row) => row.map(text)),
        rowCount: last.rowCount ?? null,
        command: last.command || null,
        hasRows: !!(last.fields && last.fields.length),
      };
    },
    close: () => client.end(),
  };
}

async function connectMysql() {
  const conn = await mysql.createConnection({
    host: config.host,
    port: Number(config.port) || 3306,
    user: config.user,
    password: config.password || undefined,
    database: config.database || undefined,
    ssl,
    connectTimeout: 20000,
    multipleStatements: true,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    rowsAsArray: true,
  });
  conn.on('error', (e) => fail(friendly(e)));
  const [v] = /** @type {any} */ (await conn.query('SELECT VERSION() AS v'));
  return {
    version: `MySQL ${v[0][0]}`,
    async query(sql, params) {
      const [result, fields] = /** @type {any} */ (await conn.query({ sql, values: params }));
      // Several statements give a list of results; the last one is shown.
      // Each statement has its field list there, or undefined when it returns no rows.
      const multi = Array.isArray(fields) && fields.length > 0 && (fields[0] === undefined || Array.isArray(fields[0]));
      const r = multi ? result[result.length - 1] : result;
      const f = multi ? fields[fields.length - 1] : fields;
      if (Array.isArray(r)) {
        return { columns: (f || []).map((/** @type {any} */ x) => x.name), rows: r.map((/** @type {unknown[]} */ row) => row.map(text)), rowCount: r.length, command: 'SELECT', hasRows: true };
      }
      return { columns: [], rows: [], rowCount: r && typeof r.affectedRows === 'number' ? r.affectedRows : null, command: null, hasRows: false };
    },
    close: () => conn.end(),
  };
}

(async () => {
  if (config.kind !== 'postgres' && config.kind !== 'mysql') fail('usage: TIDE_SQL with kind "postgres" or "mysql"');
  let db;
  try {
    db = config.kind === 'postgres' ? await connectPostgres() : await connectMysql();
  } catch (e) {
    fail(friendly(e));
    return;
  }
  out({ type: 'ready', version: db.version });

  // One request at a time, in order: a single connection can't run two.
  let chain = Promise.resolve();
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
        chain.then(() => db.close()).finally(() => process.exit(0));
        return;
      }
      chain = chain.then(() =>
        db.query(req.sql, req.params || []).then(
          (result) => out({ id: req.id, ok: true, ...result }),
          (e) => out({ id: req.id, ok: false, error: e && e.message ? e.message : String(e) }),
        ),
      );
    }
  });
  process.stdin.on('end', () => chain.then(() => db.close()).finally(() => process.exit(0)));
})();
