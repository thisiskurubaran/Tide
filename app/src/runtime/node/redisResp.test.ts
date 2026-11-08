/**
 * @jest-environment node
 */
/// <reference types="node" />
// The Redis client's RESP3 replies (after HELLO 3) and what happens when the
// server sends something that isn't RESP at all: the pending commands fail
// with the reason, instead of the parser throwing in the socket's data handler.
import net from 'net';
import type { AddressInfo } from 'net';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Parser, connect } = require('../../../nodejs-assets/nodejs-project/redis/resp.js');

function parseAll(wire: string) {
  const bytes = Buffer.from(wire);
  const p = new Parser();
  const got: unknown[] = [];
  // Byte by byte, as a slow network might deliver it.
  for (let i = 0; i < bytes.length; i++) {
    p.push(bytes.subarray(i, i + 1));
    let r;
    while ((r = p.next())) got.push(r);
  }
  return got;
}

describe('RESP3 replies', () => {
  it('reads maps, sets, nulls, booleans, doubles, big numbers, verbatim strings and bulk errors', () => {
    const wire = [
      '%2\r\n$6\r\nserver\r\n$5\r\nredis\r\n$5\r\nproto\r\n:3\r\n',
      '~2\r\n$1\r\na\r\n$1\r\nb\r\n',
      '_\r\n',
      '#t\r\n#f\r\n',
      ',3.14\r\n,inf\r\n',
      '(3492890328409238509324850943850943825024385\r\n',
      '=15\r\ntxt:Some string\r\n',
      '!21\r\nSYNTAX invalid syntax\r\n',
      '%1\r\n$1\r\nk\r\n*2\r\n_\r\n%0\r\n',
    ].join('');
    expect(parseAll(wire).map((r) => (r as { value: unknown }).value)).toEqual([
      ['server', 'redis', 'proto', 3],
      ['a', 'b'],
      null,
      1,
      0,
      '3.14',
      'inf',
      '3492890328409238509324850943850943825024385',
      'Some string',
      { error: 'SYNTAX invalid syntax' },
      ['k', [null, []]],
    ]);
  });

  it('skips attributes, and marks pushes as answering no command', () => {
    const wire = '|1\r\n+key-popularity\r\n%1\r\n$1\r\na\r\n,0.19\r\n*1\r\n:2\r\n>3\r\n$7\r\nmessage\r\n$2\r\nch\r\n$2\r\nhi\r\n:5\r\n';
    expect(parseAll(wire)).toEqual([{ value: [2] }, { value: ['message', 'ch', 'hi'], push: true }, { value: 5 }]);
  });
});

describe('the connection', () => {
  /** A fake server that answers every command with the next canned reply. */
  async function fakeServer(replies: string[]) {
    const server = net.createServer((socket) => {
      socket.on('data', () => socket.write(replies.shift() ?? ''));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as AddressInfo).port, close: () => server.close() };
  }

  it('matches replies to commands around a push, after HELLO 3', async () => {
    const server = await fakeServer(['%1\r\n$5\r\nproto\r\n:3\r\n', '>2\r\n+invalidate\r\n*1\r\n$1\r\nk\r\n$1\r\nv\r\n']);
    const redis = await connect({ host: '127.0.0.1', port: server.port });
    try {
      expect(await redis.call([['HELLO', '3']])).toEqual([['proto', 3]]);
      expect(await redis.call([['GET', 'k']])).toEqual(['v']);
    } finally {
      redis.close();
      server.close();
    }
  });

  const push = (...items: (string | number | null)[]) =>
    `>${items.length}\r\n` +
    items.map((i) => (i === null ? '_\r\n' : typeof i === 'number' ? `:${i}\r\n` : `$${Buffer.byteLength(i)}\r\n${i}\r\n`)).join('');

  it('answers RESP3 SUBSCRIBE and UNSUBSCRIBE with their confirmation pushes, and passes messages on', async () => {
    const server = await fakeServer([
      // SUBSCRIBE a b: a message for a arrives between the two confirmations.
      push('subscribe', 'a', 1) + push('message', 'a', 'early') + push('subscribe', 'b', 2),
      push('message', 'b', 'hi') + '+PONG\r\n',
      push('unsubscribe', 'a', 1),
      // UNSUBSCRIBE with no channels: one per channel left (b), then a GET's reply.
      push('unsubscribe', 'b', 0) + '$1\r\nv\r\n',
      push('unsubscribe', null, 0),
    ]);
    const redis = await connect({ host: '127.0.0.1', port: server.port });
    const pushes: unknown[] = [];
    redis.onPush((v: unknown) => pushes.push(v));
    try {
      expect(await redis.call([['SUBSCRIBE', 'a', 'b']])).toEqual([
        [
          ['subscribe', 'a', 1],
          ['subscribe', 'b', 2],
        ],
      ]);
      expect(await redis.call([['PING']])).toEqual([{ status: 'PONG' }]);
      expect(await redis.call([['UNSUBSCRIBE', 'a']])).toEqual([['unsubscribe', 'a', 1]]);
      expect(await redis.call([['UNSUBSCRIBE'], ['GET', 'k']])).toEqual([['unsubscribe', 'b', 0], 'v']);
      // Not subscribed to anything: a single confirmation with no channel.
      expect(await redis.call([['UNSUBSCRIBE']])).toEqual([['unsubscribe', null, 0]]);
      expect(pushes).toEqual([
        ['message', 'a', 'early'],
        ['message', 'b', 'hi'],
      ]);
    } finally {
      redis.close();
      server.close();
    }
  });

  it('keeps RESP2 subscribe confirmations and messages apart from replies', async () => {
    const arr = (...items: (string | number)[]) =>
      `*${items.length}\r\n` + items.map((i) => (typeof i === 'number' ? `:${i}\r\n` : `$${i.length}\r\n${i}\r\n`)).join('');
    const server = await fakeServer([arr('psubscribe', 'n*', 1) + arr('pmessage', 'n*', 'news', 'x'), arr('pong', '')]);
    const redis = await connect({ host: '127.0.0.1', port: server.port });
    const pushes: unknown[] = [];
    redis.onPush((v: unknown) => pushes.push(v));
    try {
      expect(await redis.call([['PSUBSCRIBE', 'n*']])).toEqual([['psubscribe', 'n*', 1]]);
      expect(await redis.call([['PING']])).toEqual([['pong', '']]);
      expect(pushes).toEqual([['pmessage', 'n*', 'news', 'x']]);
    } finally {
      redis.close();
      server.close();
    }
  });

  it('fails the pending command, without throwing, on a reply that is not RESP', async () => {
    const server = await fakeServer(['@what\r\n']);
    const redis = await connect({ host: '127.0.0.1', port: server.port });
    const closed = new Promise<Error>((resolve) => redis.onClose(resolve));
    try {
      expect(await redis.call([['PING']])).toEqual([{ error: 'Unexpected reply from the server ("@").' }]);
      expect((await closed).message).toMatch(/Unexpected reply/);
      await expect(redis.call([['PING']])).rejects.toThrow(/Unexpected reply/);
    } finally {
      server.close();
    }
  });
});
