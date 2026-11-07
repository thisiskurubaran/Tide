// @ts-check
// A small Redis client: RESP2 (and RESP3 replies, after HELLO 3) over net or tls, commands answered in order.
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
  // A RESP3 push (`push: true`) answers no command. Throws on bytes that
  // aren't RESP, after which the stream can't be followed any further.
  next() {
    const r = this.read(0);
    if (!r) return undefined;
    this.buf = this.buf.subarray(r.end);
    return r.push ? { value: r.value, push: true } : { value: r.value };
  }

  /**
   * @param {number} at
   * @returns {{ value: any, end: number, push?: boolean } | null}
   */
  read(at) {
    const nl = this.buf.indexOf('\r\n', at);
    if (nl === -1) return null;
    const type = String.fromCharCode(this.buf[at]);
    const line = this.buf.toString('utf8', at + 1, nl);
    const after = nl + 2;
    /** A length-prefixed string (bulk, verbatim, bulk error). */
    const bulk = () => {
      const len = Number(line);
      if (len < 0) return { value: null, end: after };
      if (this.buf.length < after + len + 2) return null;
      return { value: this.buf.toString('utf8', after, after + len), end: after + len + 2 };
    };
    /** `count` replies in a row, from `after`. */
    const many = (/** @type {number} */ count) => {
      const items = [];
      let end = after;
      for (let i = 0; i < count; i++) {
        const item = this.read(end);
        if (!item) return null;
        items.push(item.value);
        end = item.end;
      }
      return { items, end };
    };
    switch (type) {
      case '+':
        return { value: { status: line }, end: after };
      case '-':
        return { value: { error: line }, end: after };
      case ':': {
        const n = Number(line);
        return { value: Number.isSafeInteger(n) ? n : line, end: after };
      }
      case '$':
        return bulk();
      case '*':
      case '~': // RESP3 set: an array here
      case '>': {
        // RESP3 push: out of band, not the answer to a command.
        const count = Number(line);
        if (count < 0) return { value: null, end: after };
        const r = many(count);
        if (!r) return null;
        return type === '>' ? { value: r.items, end: r.end, push: true } : { value: r.items, end: r.end };
      }
      // RESP3 map: flattened to [key, value, ...], as RESP2 sends it (HGETALL, HELLO).
      case '%': {
        const r = many(Number(line) * 2);
        return r && { value: r.items, end: r.end };
      }
      // RESP3 attribute: metadata about the reply that follows, which is the reply.
      case '|': {
        const r = many(Number(line) * 2);
        if (!r) return null;
        return this.read(r.end);
      }
      case '_':
        return { value: null, end: after };
      // Booleans as RESP2's 1 and 0; doubles and big numbers as text, as RESP2 sends them.
      case '#':
        return { value: line === 't' ? 1 : 0, end: after };
      case ',':
      case '(':
        return { value: line, end: after };
      // Verbatim string: "txt:" or "mkd:" then the text.
      case '=': {
        const r = bulk();
        return r && { value: typeof r.value === 'string' ? r.value.slice(4) : r.value, end: r.end };
      }
      case '!': {
        const r = bulk();
        return r && { value: { error: r.value }, end: r.end };
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
      try {
        let r;
        while ((r = parser.next())) if (!r.push) waiting.shift()?.(r.value);
      } catch (e) {
        // Out of step with the server: every pending command fails with the
        // reason, and the connection closes, instead of throwing in here.
        gone = /** @type {Error} */ (e);
        socket.destroy();
      }
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
