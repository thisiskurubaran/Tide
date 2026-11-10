// @ts-check
// tide:redis opens a Redis connection for the app's database viewer.
//
//   TIDE_REDIS (env, JSON) holds the connection: host, port, user, password,
//   db (index) and ssl ("off" | "require" | "verify"). It's only in this
//   worker's environment; nothing is written to disk.
//
// Once connected it prints {"type":"ready","version":...}. Then each stdin
// line is a JSON request {id, cmds: [[name, ...args], ...]}, sent as one
// pipeline, and gets one JSON reply line {id, ok: true, replies} with a reply
// per command (see resp.js for their shape), or {id, ok: false, error}.
// Through SSH, the app first forwards a local port with tide:ssh and points
// host and port at it.
'use strict';

const { connect } = require('./resp');

const config = JSON.parse(process.env.TIDE_REDIS || '{}');

function out(/** @type {object} */ obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function fail(/** @type {string} */ message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const where = `${config.host}:${config.port}`;
function friendly(/** @type {any} */ e) {
  const m = String((e && e.message) || e);
  if (/ECONNREFUSED/.test(m)) return `${where} refused the connection. Is the server running, and is the port right?`;
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return `Can't find ${config.host}.`;
  if (/ETIMEDOUT|timeout/i.test(m)) return `${where} didn't answer.`;
  if (/self[- ]signed|unable to verify|certificate/i.test(m)) return `${m}. Choose "Require" instead of "Verify" for TLS to accept the server's certificate.`;
  if (/ECONNRESET|EPIPE/.test(m) && config.ssl === 'off') return `${where} closed the connection. If it needs TLS, edit the connection and turn it on.`;
  return m;
}

(async () => {
  if (!config.host) fail('usage: TIDE_REDIS with host and port');
  let redis;
  try {
    redis = await connect({ host: config.host, port: Number(config.port) || 6379, ssl: config.ssl });
    /** @type {string[][]} */
    const hello = [];
    if (config.password) hello.push(config.user ? ['AUTH', config.user, config.password] : ['AUTH', config.password]);
    if (Number(config.db)) hello.push(['SELECT', String(Number(config.db))]);
    hello.push(['INFO', 'server']);
    const replies = await redis.call(hello);
    const bad = replies.find((r) => r && typeof r === 'object' && 'error' in r);
    if (bad) throw new Error(/NOAUTH/.test(bad.error) ? 'The server needs a password.' : bad.error);
    const info = String(replies[replies.length - 1]);
    const version = (/redis_version:([^\r\n]+)/.exec(info) || [])[1];
    // Valkey and other forks answer INFO the same way and name themselves.
    const server = /valkey_version:/.test(info) ? 'Valkey' : 'Redis';
    out({ type: 'ready', version: version ? `${server} ${version.trim()}` : 'Redis' });
  } catch (e) {
    fail(friendly(e));
    return;
  }
  redis.onClose((e) => fail(friendly(e)));

  // Requests in flight, so closing waits for their replies.
  let inflight = Promise.resolve();
  const finish = () => inflight.then(() => redis.close()).finally(() => process.exit(0));
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
      const cmds = Array.isArray(req.cmds) ? req.cmds.filter((/** @type {unknown} */ c) => Array.isArray(c) && c.length) : [];
      // Commands that would take over the connection would leave the viewer waiting forever.
      const blocked = cmds.find((/** @type {string[]} */ c) => /^(subscribe|psubscribe|ssubscribe|monitor|sync|psync)$/i.test(String(c[0])));
      if (blocked) {
        out({ id: req.id, ok: false, error: `${String(blocked[0]).toUpperCase()} isn't supported here; use redis-cli in a terminal for it.` });
        continue;
      }
      // Replies come back in the order sent, so requests can overlap.
      const done = redis.call(cmds.map((/** @type {unknown[]} */ c) => c.map(String))).then(
        (replies) => out({ id: req.id, ok: true, replies }),
        (e) => out({ id: req.id, ok: false, error: friendly(e) }),
      );
      inflight = inflight.then(() => done);
    }
  });
  process.stdin.on('end', finish);
})();
