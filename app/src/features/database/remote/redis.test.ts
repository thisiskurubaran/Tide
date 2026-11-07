/**
 * @jest-environment node
 */
/// <reference types="node" />
// The console's parsing and printing, the protocol parser, and, when a server
// is given, everything the viewer does against it through tide:redis, e.g.
//   TIDE_TEST_REDIS='{"host":"127.0.0.1","port":6379,"password":"pw"}'
// Each run uses its own keys in database 9 and deletes them after.
import { deleteKey, formatReply, formatTtl, listDatabases, readValue, RedisClient, Reply, runCommand, scanKeys, selectDb, setString, splitCommand, STRING_LIMIT } from './redis';
import { spawnLines } from './lines.testutil';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Parser, encode } = require('../../../../nodejs-assets/nodejs-project/redis/resp.js');

describe('splitCommand', () => {
  it('splits like redis-cli', () => {
    expect(splitCommand('  SET  greeting   hello ')).toEqual(['SET', 'greeting', 'hello']);
    expect(splitCommand('SET k "two words\\n\\x41"')).toEqual(['SET', 'k', 'two words\nA']);
    expect(splitCommand("SET k 'it\\'s \\n raw'")).toEqual(['SET', 'k', "it's \\n raw"]);
    expect(splitCommand('HSET h "" x')).toEqual(['HSET', 'h', '', 'x']);
    expect(splitCommand('')).toEqual([]);
    expect(() => splitCommand('GET "open')).toThrow('quote');
  });
});

describe('formatReply', () => {
  it('prints like redis-cli', () => {
    expect(formatReply({ status: 'OK' })).toBe('OK');
    expect(formatReply({ error: 'ERR nope' })).toBe('(error) ERR nope');
    expect(formatReply(3)).toBe('(integer) 3');
    expect(formatReply(null)).toBe('(nil)');
    expect(formatReply('a "b"')).toBe('"a \\"b\\""');
    expect(formatReply([])).toBe('(empty array)');
    expect(formatReply(['0', ['a', 'b']])).toBe('1) "0"\n2) 1) "a"\n   2) "b"');
    const ten = Array.from({ length: 10 }, (_, i) => String(i));
    expect(formatReply(ten).split('\n')[0]).toBe(' 1) "0"');
  });

  it('shows TTLs briefly', () => {
    expect(formatTtl(-1)).toBe('no expiry');
    expect(formatTtl(1500)).toBe('2s');
    expect(formatTtl(200_000)).toBe('3m 20s');
    expect(formatTtl(7_500_000)).toBe('2h 5m');
    expect(formatTtl(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h');
  });
});

describe('the protocol parser', () => {
  it('reads replies split anywhere, nested and empty', () => {
    const wire = Buffer.from('+OK\r\n-ERR bad\r\n:42\r\n:9007199254740993\r\n$-1\r\n$4\r\nhé!\r\n*2\r\n*1\r\n$0\r\n\r\n*-1\r\n*0\r\n');
    const p = new Parser();
    const got: Reply[] = [];
    // Byte by byte, as a slow network might deliver it.
    for (let i = 0; i < wire.length; i++) {
      p.push(wire.subarray(i, i + 1));
      let r;
      while ((r = p.next())) got.push(r.value);
    }
    expect(got).toEqual([{ status: 'OK' }, { error: 'ERR bad' }, 42, '9007199254740993', null, 'hé!', [[''], null], []]);
  });

  it('writes commands with byte lengths', () => {
    expect(encode(['SET', 'k', 'é'])).toBe('*3\r\n$3\r\nSET\r\n$1\r\nk\r\n$2\r\né\r\n');
  });
});

const server = process.env.TIDE_TEST_REDIS;
const run = server ? it : it.skip;

async function connect(): Promise<RedisClient & { version: string }> {
  const lines = await spawnLines('redis', { TIDE_REDIS: JSON.stringify({ ssl: 'off', ...JSON.parse(server!), db: 9 }) });
  return { version: lines.version, call: async (cmds) => (await lines.request({ cmds })).replies, close: () => lines.close() };
}

describe('against a server', () => {
  const p = `tide_test_${Date.now().toString(36)}`;

  run('browses keys with SCAN, reads every type, edits, deletes and runs commands', async () => {
    const r = await connect();
    try {
      expect(r.version).toMatch(/^(Redis|Valkey) \d/);
      // Started on database 9, as configured.
      expect(await runCommand(r, 'CLIENT INFO')).toMatchObject({ reply: expect.stringContaining('db=9') });

      const many = Array.from({ length: 250 }, (_, i) => ['SET', `${p}:n:${i}`, String(i)]);
      await r.call([
        ...many,
        ['SET', `${p}:str`, 'hello'],
        ['PEXPIRE', `${p}:str`, '600000'],
        ['HSET', `${p}:hash`, 'name', 'Ada', 'born', '1815'],
        ['RPUSH', `${p}:list`, ...Array.from({ length: 150 }, (_, i) => `item${i}`)],
        ['SADD', `${p}:set`, 'a', 'b', 'c'],
        ['ZADD', `${p}:zset`, '1', 'one', '2', 'two', '3', 'three'],
        ['XADD', `${p}:stream`, '1-1', 'temp', '20'],
        ['XADD', `${p}:stream`, '1-2', 'temp', '21', 'unit', 'C'],
      ]);

      // A page is at least the size asked for (SCAN's COUNT is a hint), and the rest follows.
      const first = await scanKeys(r, '0', `${p}:n:*`, 100);
      expect(first.keys.length).toBeGreaterThanOrEqual(100);
      const seen = new Set(first.keys.map((k) => k.key));
      let cursor = first.cursor;
      while (cursor !== '0') {
        const next = await scanKeys(r, cursor, `${p}:n:*`, 100);
        next.keys.forEach((k) => seen.add(k.key));
        cursor = next.cursor;
      }
      expect(seen.size).toBe(250);

      const all = await scanKeys(r, '0', `${p}:[^n]*`, 1000);
      const byKey = Object.fromEntries(all.keys.map((k) => [k.key, k]));
      expect(Object.fromEntries(all.keys.map((k) => [k.key.slice(p.length + 1), k.type]))).toEqual({ str: 'string', hash: 'hash', list: 'list', set: 'set', zset: 'zset', stream: 'stream' });
      expect(byKey[`${p}:str`].ttl).toBeGreaterThan(590_000);
      expect(byKey[`${p}:hash`].ttl).toBe(-1);

      expect(await readValue(r, `${p}:str`, 'string')).toEqual({ kind: 'string', text: 'hello', length: 5, truncated: false });
      expect(await readValue(r, `${p}:hash`, 'hash')).toMatchObject({ columns: ['field', 'value'], total: 2, cursor: null });
      expect((await readValue(r, `${p}:hash`, 'hash')).kind === 'items' && new Set((await readValue(r, `${p}:hash`, 'hash') as any).rows.map(String))).toEqual(new Set(['name,Ada', 'born,1815']));

      const list = await readValue(r, `${p}:list`, 'list');
      expect(list).toMatchObject({ total: 150, cursor: '100' });
      const rest = await readValue(r, `${p}:list`, 'list', '100');
      expect(rest.kind === 'items' && rest.rows[0]).toEqual(['100', 'item100']);
      expect(rest).toMatchObject({ cursor: null });

      expect(await readValue(r, `${p}:set`, 'set')).toMatchObject({ total: 3 });
      expect(await readValue(r, `${p}:zset`, 'zset')).toMatchObject({ rows: [['one', '1'], ['two', '2'], ['three', '3']], total: 3 });
      expect(await readValue(r, `${p}:stream`, 'stream')).toMatchObject({ rows: [['1-1', 'temp=20'], ['1-2', 'temp=21  unit=C']], total: 2, cursor: null });

      // Editing a string keeps its expiry.
      await setString(r, `${p}:str`, 'changed');
      expect(await readValue(r, `${p}:str`, 'string')).toMatchObject({ text: 'changed' });
      expect((await r.call([['PTTL', `${p}:str`]]))[0]).toBeGreaterThan(590_000);

      // Long strings are cut for viewing.
      await r.call([['SET', `${p}:big`, 'x'.repeat(STRING_LIMIT + 10)]]);
      expect(await readValue(r, `${p}:big`, 'string')).toMatchObject({ length: STRING_LIMIT + 10, truncated: true });

      await deleteKey(r, `${p}:hash`);
      await expect(deleteKey(r, `${p}:hash`)).rejects.toThrow('gone');

      const dbs = await listDatabases(r);
      expect(dbs.count).toBeGreaterThanOrEqual(10);
      expect(dbs.keys[9]).toBeGreaterThanOrEqual(250);

      // Console: replies, errors, and SELECT telling the view where it is.
      expect(await runCommand(r, `GET ${p}:str`)).toEqual({ reply: 'changed' });
      expect(formatReply((await runCommand(r, 'NOPE')).reply)).toMatch(/^\(error\) ERR unknown command/);
      expect(await runCommand(r, 'SELECT 3')).toEqual({ reply: { status: 'OK' }, db: 3 });
      expect((await runCommand(r, `EXISTS ${p}:str`)).reply).toBe(0);
      await selectDb(r, 9);
      expect((await runCommand(r, `EXISTS ${p}:str`)).reply).toBe(1);
    } finally {
      const keys = (await scanKeys(r, '0', `${p}:*`, 100000)).keys.map((k) => k.key);
      if (keys.length) await r.call([['DEL', ...keys]]);
      await r.close();
    }
  });

  run('says when the password is wrong', async () => {
    const config = JSON.parse(server!);
    await expect(spawnLines('redis', { TIDE_REDIS: JSON.stringify({ ...config, password: 'not-the-password', user: config.user }) })).rejects.toThrow(/WRONGPASS|invalid|password/i);
  });
});
