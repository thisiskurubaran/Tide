// @ts-check
// A small Redis client: RESP2 over net or tls, commands answered in order.
// Written here instead of bundling ioredis, which is 30x the size for the
// handful of things the database viewer does.
'use strict';

const net = require('net');
const tls = require('tls');

/** @param {string[]} args */
function encode(args) {
  const parts = [`*${args.length}\r\n`];
  for (const a of args) parts.push(`$${Buffer.byteLength(a)}\r\n${a}\r\n`);
  return parts.join('');
}

// Replies as JSON-friendly values: bulk strings as text, integers as numbers
// (as text past 2^53), nil as null, arrays as arrays, and {status} / {error}
// for simple strings and errors so the console can show them like redis-cli.
class Parser {
  constructor() {
    /** @type {Buffer} */
    this.buf = Buffer.alloc(0);
  }

  /** @param {Buffer} chunk */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
  }

  // The next whole reply, or undefined when more bytes are needed.
  next() {
    const r = this.read(0);
    if (!r) return undefined;
    this.buf = this.buf.subarray(r.end);
    return { value: r.value };
  }

  /** @param {number} at @returns {{ value: any, end: number } | null} */
  read(at) {
    const nl = this.buf.indexOf('\r\n', at);
    if (nl === -1) return null;
    const type = String.fromCharCode(this.buf[at]);
    const line = this.buf.toString('utf8', at + 1, nl);
    const after = nl + 2;
    switch (type) {
      case '+':
        return { value: { status: line }, end: after };
      case '-':
        return { value: { error: line }, end: after };
      case ':': {
        const n = Number(line);
        return { value: Number.isSafeInteger(n) ? n : line, end: after };
      }
      case '$': {
        const len = Number(line);
        if (len < 0) return { value: null, end: after };
        if (this.buf.length < after + len + 2) return null;
        return { value: this.buf.toString('utf8', after, after + len), end: after + len + 2 };
      }
      case '*': {
        const count = Number(line);
        if (count < 0) return { value: null, end: after };
        const items = [];
        let end = after;
        for (let i = 0; i < count; i++) {
          const item = this.read(end);
          if (!item) return null;
          items.push(item.value);
          end = item.end;
        }
        return { value: items, end };
      }
      default:
        throw new Error(`Unexpected reply from the server (${JSON.stringify(type)}).`);
    }
  }
}

/**
 * @param {{ host: string, port: number, ssl?: 'off' | 'require' | 'verify', timeoutMs?: number }} opts
 * @returns {Promise<{ call(args: string[][]): Promise<any[]>, close(): void, onClose(fn: (e: Error) => void): void }>}
 */
function connect(opts) {
  return new Promise((resolve, reject) => {
    const secure = opts.ssl === 'require' || opts.ssl === 'verify';
    const socket = secure
      ? tls.connect({ host: opts.host, port: opts.port, servername: net.isIP(opts.host) ? undefined : opts.host, rejectUnauthorized: opts.ssl === 'verify' })
      : net.connect({ host: opts.host, port: opts.port });
    const parser = new Parser();
    /** @type {((v: any) => void)[]} */
    const waiting = [];
    /** @type {((e: Error) => void)[]} */
    const closers = [];
    let open = false;
    let gone = /** @type {Error | null} */ (null);

    socket.setTimeout(opts.timeoutMs ?? 20000, () => socket.destroy(new Error('timeout')));
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      open = true;
      socket.setTimeout(0);
      socket.setKeepAlive(true, 30000);
      resolve({
        call(cmds) {
          if (gone) return Promise.reject(gone);
          socket.write(cmds.map(encode).join(''));
          return Promise.all(cmds.map(() => new Promise((res) => waiting.push(res))));
        },
        close: () => socket.end(),
        onClose: (fn) => closers.push(fn),
      });
    });
    socket.on('data', (chunk) => {
      parser.push(chunk);
      let r;
      while ((r = parser.next())) waiting.shift()?.(r.value);
    });
    socket.on('error', (e) => {
      gone = e;
      if (!open) reject(e);
    });
    socket.on('close', () => {
      gone = gone || new Error('The connection closed.');
      for (const w of waiting.splice(0)) w({ error: gone.message });
      for (const fn of closers) fn(gone);
    });
  });
}

module.exports = { connect, encode, Parser };
