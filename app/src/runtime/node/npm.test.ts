/**
 * @jest-environment node
 */
/// <reference types="node" />
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

/* eslint-disable @typescript-eslint/no-require-imports */
const semver = require('../../../nodejs-assets/nodejs-project/npm/semver');
const { extract } = require('../../../nodejs-assets/nodejs-project/npm/tar');
const { install, uninstall, parseSpec } = require('../../../nodejs-assets/nodejs-project/npm/install');
/* eslint-enable @typescript-eslint/no-require-imports */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tide-npm-'));

// Builds a .tgz the way npm publishes them: everything under "package/".
function tarball(files: Record<string, string>) {
  const dir = tmp();
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, 'package', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const out = path.join(dir, 'pkg.tgz');
  execFileSync('tar', ['-czf', out, '-C', dir, 'package']);
  return fs.readFileSync(out);
}

describe('semver', () => {
  it.each([
    ['1.2.3', '^1.0.0', true],
    ['2.0.0', '^1.0.0', false],
    ['0.2.5', '^0.2.1', true],
    ['0.3.0', '^0.2.1', false],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.9.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['3.1.4', '*', true],
    ['1.5.0', '>=1.2.0 <2.0.0', true],
    ['2.0.0', '>=1.2.0 <2.0.0', false],
    ['1.0.0', '1.0.0 - 1.4', true],
    ['1.5.0', '1.0.0 - 1.4', false],
    ['3.0.0', '^1.0.0 || ^3.0.0', true],
    ['1.0.0-beta.1', '^1.0.0', false],
    ['1.0.0-beta.2', '>=1.0.0-beta.1', true],
    ['1.0.0', '>= 0.8', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '=1.2.3', false],
  ])('%s satisfies %s: %s', (version, range, expected) => {
    expect(semver.satisfies(version, range)).toBe(expected);
  });

  it('picks the highest matching version', () => {
    expect(semver.maxSatisfying(['1.0.0', '1.4.2', '1.10.0', '2.0.0'], '^1.0.0')).toBe('1.10.0');
    expect(semver.maxSatisfying(['1.0.0'], '^2.0.0')).toBeNull();
  });

  it('parses specs', () => {
    expect(parseSpec('express')).toEqual(['express', 'latest']);
    expect(parseSpec('express@^5')).toEqual(['express', '^5']);
    expect(parseSpec('@types/node@22')).toEqual(['@types/node', '22']);
    expect(parseSpec('@scope/pkg')).toEqual(['@scope/pkg', 'latest']);
  });
});

describe('tar', () => {
  it('extracts files under package/, including long paths', () => {
    const long = `${'deep/'.repeat(25)}file.js`;
    const tgz = tarball({ 'package.json': '{"name":"x"}', 'lib/a.js': 'a', [long]: 'long' });
    const dest = tmp();
    const written = extract(zlib.gunzipSync(tgz), dest);
    expect(written).toEqual(expect.arrayContaining(['package.json', 'lib/a.js', long]));
    expect(fs.readFileSync(path.join(dest, long), 'utf8')).toBe('long');
  });

  it('ignores entries that would escape the destination', () => {
    // A single ustar entry named "package/../../evil.js", written by hand.
    const header = Buffer.alloc(512);
    header.write('package/../../evil.js', 0);
    header.write('0000644\0', 100);
    header.write('00000000001\0', 124);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.fill(' ', 148, 156);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    const body = Buffer.alloc(512);
    body.write('x');
    const tar = Buffer.concat([header, body, Buffer.alloc(1024)]);

    const dest = path.join(tmp(), 'inner');
    fs.mkdirSync(dest);
    expect(extract(tar, dest)).toEqual([]);
    expect(fs.existsSync(path.join(dest, '..', 'evil.js'))).toBe(false);
  });
});

describe('install', () => {
  type Pkg = { version: string; deps?: Record<string, string>; files?: Record<string, string>; gyp?: boolean };
  let server: http.Server;
  let registry: string;
  const packages: Record<string, Pkg[]> = {
    app: [{ version: '1.0.0', deps: { a: '^1.0.0', c: '^2.0.0' } }],
    a: [
      { version: '1.0.0', deps: { b: '^1.0.0' } },
      { version: '1.2.0', deps: { b: '^1.0.0' } },
    ],
    b: [{ version: '1.0.0' }, { version: '1.1.0' }, { version: '2.0.0' }],
    c: [{ version: '2.0.0', deps: { b: '^2.0.0' } }],
    native: [{ version: '1.0.0', gyp: true, files: { 'binding.gyp': '{}' } }],
  };
  const tarballs = new Map<string, Buffer>();
  // Recorded when a tarball is first published, like the real registry.
  const integrities = new Map<string, string>();
  const requests: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push(req.url ?? '');
      const url = req.url ?? '';
      if (url.startsWith('/tarballs/')) {
        const body = tarballs.get(url);
        res.writeHead(body ? 200 : 404).end(body);
        return;
      }
      const name = decodeURIComponent(url.slice(1));
      const versions = packages[name];
      if (!versions) return void res.writeHead(404).end();
      const doc = {
        name,
        'dist-tags': { latest: versions[versions.length - 1].version },
        versions: Object.fromEntries(
          versions.map((v) => {
            const key = `/tarballs/${name}-${v.version}.tgz`;
            if (!tarballs.has(key)) {
              const tgz = tarball({ 'package.json': JSON.stringify({ name, version: v.version }), 'index.js': `module.exports = '${name}@${v.version}'`, ...(v.files ?? {}) });
              tarballs.set(key, tgz);
              integrities.set(key, `sha512-${crypto.createHash('sha512').update(tgz).digest('base64')}`);
            }
            const integrity = integrities.get(key);
            return [v.version, { name, version: v.version, dependencies: v.deps, gypfile: v.gyp, dist: { tarball: `${registry}${key}`, integrity } }];
          }),
        ),
      };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(doc));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    registry = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const read = (dir: string, rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

  it('installs dependencies, hoisting where it can and nesting on conflict', async () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'app', dependencies: { a: '^1.0.0', c: '^2.0.0' } }));
    const lines: string[] = [];
    const result = await install({ cwd, registry, log: (l: string) => lines.push(l) });
    expect(read(cwd, 'node_modules/a/package.json').version).toBe('1.2.0');
    // a wants b@1, c wants b@2: b@1 is hoisted (seen first), b@2 nests under c.
    expect(read(cwd, 'node_modules/b/package.json').version).toBe('1.1.0');
    expect(read(cwd, 'node_modules/c/node_modules/b/package.json').version).toBe('2.0.0');
    expect(result.added).toBe(4);
    expect(lines[lines.length - 1]).toMatch(/^added 4 packages in/);
  });

  it('adds a named package to package.json, then is a no-op the second time', async () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'x' }));
    await install({ cwd, registry, add: ['b@1'], log: () => {} });
    expect(read(cwd, 'package.json').dependencies).toEqual({ b: '^1.1.0' });
    expect(read(cwd, 'node_modules/b/package.json').version).toBe('1.1.0');
    const before = requests.length;
    const again = await install({ cwd, registry, log: () => {} });
    expect(again.added).toBe(0);
    expect(requests.slice(before).some((r) => r.startsWith('/tarballs/'))).toBe(false);
  });

  it('uninstalls a package and prunes what only it needed', async () => {
    const cwd = tmp();
    await install({ cwd, registry, add: ['a', 'native'], log: () => {} });
    expect(fs.existsSync(path.join(cwd, 'node_modules/b'))).toBe(true);
    const lines: string[] = [];
    await uninstall({ cwd, registry, names: ['a'], log: (l: string) => lines.push(l) });
    expect(read(cwd, 'package.json').dependencies).toEqual({ native: '^1.0.0' });
    expect(fs.readdirSync(path.join(cwd, 'node_modules'))).toEqual(['native']);
    expect(lines).toContain('removed 2 packages');
  });

  it('saves latest as a caret range and warns about native builds', async () => {
    const cwd = tmp();
    const lines: string[] = [];
    await install({ cwd, registry, add: ['native'], log: (l: string) => lines.push(l) });
    expect(read(cwd, 'package.json').dependencies).toEqual({ native: '^1.0.0' });
    expect(lines.some((l) => l.includes('native@1.0.0 needs a native build'))).toBe(true);
  });

  it('fails clearly for unknown packages and bad tarballs', async () => {
    const cwd = tmp();
    await expect(install({ cwd, registry, add: ['nope'], log: () => {} })).rejects.toThrow('nope: not found in the registry');
    // Publish b@2 first so its integrity is recorded, then swap the bytes.
    await install({ cwd: tmp(), registry, add: ['b@2'], log: () => {} });
    tarballs.set('/tarballs/b-2.0.0.tgz', Buffer.from('tampered'));
    await expect(install({ cwd, registry, add: ['b@2'], log: () => {} })).rejects.toThrow('integrity check failed');
  });
});
