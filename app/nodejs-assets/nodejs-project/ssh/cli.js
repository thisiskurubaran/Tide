// @ts-check
// tide:ssh — SSH and SFTP for the app, on the bundled ssh2 (pure JS).
//
//   TIDE_SSH (env, JSON) holds the connection: host, port, username, and a
//   password or privateKey (+ passphrase), plus the known host key fingerprint.
//   It's only in this worker's environment; nothing is written to disk.
//
//   tide:ssh shell   interactive shell. stdin goes to the remote PTY as typed;
//                    OSC "\x1b]tide-resize;COLS;ROWS\x07" in stdin resizes it.
//   tide:ssh sftp    one JSON request per stdin line, one JSON reply per stdout line.
//   tide:ssh forward local port forwarding: listens on 127.0.0.1:<localPort> and
//                    tunnels each connection to <remoteHost>:<remotePort> on the
//                    server (TIDE_SSH.forward), until stopped.
//   tide:ssh keygen  prints a new ed25519 key pair as JSON.
//   tide:ssh pubkey  prints the public key of TIDE_SSH.privateKey as JSON.
//
// The host key is checked against TIDE_SSH.fingerprint. When there isn't one
// yet, the fingerprint is printed to stderr as "TIDE-HOSTKEY <sha256>" so the
// app can remember it (trust on first use); a different key stops the connection.
// With TIDE_SSH.jump (another server's settings) the connection goes through
// that server first; its key is reported as "TIDE-HOSTKEY-JUMP <sha256>".
'use strict';

const { Client, utils } = require('./ssh2');
const crypto = require('crypto');
const net = require('net');
const path = require('path');

const mode = process.argv[2];
const config = JSON.parse(process.env.TIDE_SSH || '{}');

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (mode === 'keygen') {
  const { private: priv, public: pub } = utils.generateKeyPairSync('ed25519', { comment: config.comment || 'tide' });
  out({ privateKey: priv, publicKey: pub });
  process.exit(0);
}

if (mode === 'pubkey') {
  const key = utils.parseKey(config.privateKey || '', config.passphrase || undefined);
  if (key instanceof Error) fail(key.message);
  const parsed = Array.isArray(key) ? key[0] : key;
  out({ publicKey: `${parsed.type} ${parsed.getPublicSSH().toString('base64')}${parsed.comment ? ` ${parsed.comment}` : ''}`, type: parsed.type });
  process.exit(0);
}

if (mode !== 'shell' && mode !== 'sftp' && mode !== 'forward') fail(`usage: tide:ssh shell|sftp|forward|keygen|pubkey`);

const conn = new Client();
const fingerprint = (key) => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/** Checks a server's host key against the saved one; reports a first one under `tag`. */
function verifier(/** @type {any} */ server, /** @type {string} */ tag) {
  return (/** @type {Buffer} */ key) => {
    const fp = fingerprint(key);
    if (!server.fingerprint) {
      process.stderr.write(`${tag} ${fp}\n`);
      return true;
    }
    if (server.fingerprint === fp) return true;
    process.stderr.write(
      `The host key for ${server.host} has changed (now ${fp}). This can mean someone is intercepting the connection. If the server was reinstalled, remove the saved key in the host's settings and connect again.\n`,
    );
    return false;
  };
}

/** Connection options shared by the server and a jump host. */
function options(/** @type {any} */ server, /** @type {string} */ tag) {
  return {
    host: server.host,
    port: Number(server.port) || 22,
    username: server.username,
    password: server.password || undefined,
    privateKey: server.privateKey || undefined,
    passphrase: server.passphrase || undefined,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    // Needs WebAssembly, which nodejs-mobile on iOS doesn't have (see build-ssh.js).
    algorithms: { cipher: { remove: 'chacha20-poly1305@openssh.com' } },
    hostVerifier: verifier(server, tag),
  };
}

conn.on('error', (e) => {
  const msg = /All configured authentication methods failed/.test(e.message)
    ? 'Sign-in was refused. Check the username, password or key.'
    : /ENOTFOUND|EAI_AGAIN/.test(e.message)
      ? `Can't find ${config.host}.`
      : /ECONNREFUSED/.test(e.message)
        ? `${config.host} refused the connection on port ${config.port || 22}.`
        : /ETIMEDOUT|Timed out/.test(e.message)
          ? `${config.host} didn't answer.`
          : e.message;
  fail(msg);
});

conn.on('ready', () => (mode === 'shell' ? shell() : mode === 'sftp' ? sftp() : forward()));

if (config.jump) {
  // Through the jump host: its connection carries a tunnel to the server's SSH port.
  const jump = new Client();
  jump.on('error', (e) => fail(`Jump host ${config.jump.host}: ${e.message}`));
  jump.on('ready', () =>
    jump.forwardOut('127.0.0.1', 0, config.host, Number(config.port) || 22, (err, sock) => {
      if (err) fail(`Jump host ${config.jump.host} couldn't reach ${config.host}: ${err.message}`);
      conn.connect({ ...options(config, 'TIDE-HOSTKEY'), sock });
    }),
  );
  jump.connect(options(config.jump, 'TIDE-HOSTKEY-JUMP'));
} else {
  conn.connect(options(config, 'TIDE-HOSTKEY'));
}

function forward() {
  const { localPort, remoteHost = '127.0.0.1', remotePort } = config.forward || {};
  const server = net.createServer((sock) => {
    conn.forwardOut('127.0.0.1', sock.remotePort || 0, remoteHost, Number(remotePort), (err, stream) => {
      if (err) {
        process.stderr.write(`Couldn't reach ${remoteHost}:${remotePort} on the server: ${err.message}\n`);
        sock.destroy();
        return;
      }
      sock.pipe(stream).pipe(sock);
      stream.on('error', () => sock.destroy());
      sock.on('error', () => stream.destroy());
    });
  });
  server.on('error', (e) => fail(`Can't listen on port ${localPort}: ${e.message}`));
  // The worker bootstrap reports the listening port, so the app can preview it.
  server.listen(Number(localPort), '127.0.0.1', () => process.stdout.write(`Forwarding localhost:${localPort} to ${remoteHost}:${remotePort} on ${config.host}\n`));
  conn.on('close', () => {
    server.close();
    process.exit(0);
  });
}

function shell() {
  const cols = Number(config.cols) || 80;
  const rows = Number(config.rows) || 24;
  conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
    if (err) fail(err.message);
    stream.on('data', (/** @type {Buffer} */ d) => process.stdout.write(d));
    stream.stderr.on('data', (/** @type {Buffer} */ d) => process.stdout.write(d));
    stream.on('close', () => {
      conn.end();
      process.exit(0);
    });
    const RESIZE = /\x1b\]tide-resize;(\d+);(\d+)\x07/g;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (/** @type {string} */ chunk) => {
      const text = chunk.replace(RESIZE, (_m, c, r) => {
        stream.setWindow(Number(r), Number(c), 0, 0);
        return '';
      });
      if (text) stream.write(text);
    });
  });
}

function sftp() {
  conn.sftp((err, sftp) => {
    if (err) fail(err.message);
    out({ ready: true, home: '.' });
    /** @type {(fn: (cb: (e: Error | null | undefined, v?: any) => void) => void) => Promise<any>} */
    const call = (fn) => new Promise((resolve, reject) => fn((e, v) => (e ? reject(e) : resolve(v))));
    const handlers = {
      realpath: (/** @type {any} */ r) => call((cb) => sftp.realpath(r.path || '.', cb)),
      list: async (/** @type {any} */ r) => {
        const entries = await call((cb) => sftp.readdir(r.path, cb));
        return entries
          .map((/** @type {any} */ e) => ({ name: e.filename, kind: e.attrs.isDirectory() ? 'dir' : e.attrs.isSymbolicLink() ? 'link' : 'file', size: e.attrs.size, mtime: e.attrs.mtime }))
          .sort((/** @type {any} */ a, /** @type {any} */ b) => (a.kind === 'dir') === (b.kind === 'dir') ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1);
      },
      read: async (/** @type {any} */ r) => {
        const stat = await call((cb) => sftp.stat(r.path, cb));
        if (stat.size > (r.max || 5 * 1024 * 1024)) throw new Error(`${path.posix.basename(r.path)} is ${Math.round(stat.size / 1024 / 1024)} MB; too big to open here.`);
        const data = await new Promise((resolve, reject) => {
          const chunks = [];
          sftp.createReadStream(r.path).on('data', (/** @type {Buffer} */ c) => chunks.push(c)).on('error', reject).on('end', () => resolve(Buffer.concat(chunks)));
        });
        return { base64: /** @type {Buffer} */ (data).toString('base64') };
      },
      write: (/** @type {any} */ r) =>
        new Promise((resolve, reject) => {
          const stream = sftp.createWriteStream(r.path);
          stream.on('error', reject).on('close', () => resolve(true));
          stream.end(Buffer.from(r.base64, 'base64'));
        }),
      mkdir: (/** @type {any} */ r) => call((cb) => sftp.mkdir(r.path, cb)),
      rename: (/** @type {any} */ r) => call((cb) => sftp.rename(r.path, r.to, cb)),
      remove: async (/** @type {any} */ r) => {
        const stat = await call((cb) => sftp.lstat(r.path, cb));
        if (stat.isDirectory()) return call((cb) => sftp.rmdir(r.path, cb));
        return call((cb) => sftp.unlink(r.path, cb));
      },
    };
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
          conn.end();
          process.exit(0);
        }
        const handler = /** @type {any} */ (handlers)[req.op];
        Promise.resolve(handler ? handler(req) : Promise.reject(new Error(`unknown op ${req.op}`))).then(
          (result) => out({ id: req.id, ok: true, result }),
          (e) => out({ id: req.id, ok: false, error: e && e.message ? e.message : String(e) }),
        );
      }
    });
  });
}
