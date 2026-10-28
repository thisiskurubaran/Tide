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

/* eslint-disable @typescript-eslint/no-require-imports */
const pep440 = require('../../../nodejs-assets/nodejs-project/pip/pep440');
const markers = require('../../../nodejs-assets/nodejs-project/pip/markers');
const zip = require('../../../nodejs-assets/nodejs-project/pip/zip');
const { install, uninstall, list, parseRequirement } = require('../../../nodejs-assets/nodejs-project/pip/install');
/* eslint-enable @typescript-eslint/no-require-imports */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tide-pip-'));

// Builds a .whl with Python's zipfile (deflated), like real wheels.
function wheel(files: Record<string, string>) {
  const dir = tmp();
  const out = path.join(dir, 'w.whl');
  const script = `import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)\nfor k,v in json.loads(sys.argv[2]).items(): z.writestr(k,v)\nz.close()`;
  execFileSync('python3', ['-c', script, out, JSON.stringify(files)]);
  return fs.readFileSync(out);
}

describe('pep440', () => {
  it.each([
    ['2.31.0', '>=2.0,<3', true],
    ['3.0.0', '>=2.0,<3', false],
    ['1.4.2', '~=1.4', true],
    ['2.0', '~=1.4', false],
    ['1.4.5', '~=1.4.2', true],
    ['1.5.0', '~=1.4.2', false],
    ['1.2.9', '==1.2.*', true],
    ['1.3.0', '==1.2.*', false],
    ['2.0.0b1', '>=1.0', false],
    ['2.0.0b1', '>=2.0.0b1', true],
    ['1.0.post1', '>1.0', false],
    ['1.0', '', true],
    ['1.0', '!=1.0', false],
  ])('%s satisfies "%s": %s', (v, spec, expected) => {
    expect(pep440.satisfies(v, spec)).toBe(expected);
  });

  it('orders dev < pre < final < post', () => {
    const sorted = ['1.0.post1', '1.0', '1.0rc1', '1.0.dev1', '1.0a2', '1.0b1'].sort((a, b) => pep440.compare(pep440.parse(a), pep440.parse(b)));
    expect(sorted).toEqual(['1.0.dev1', '1.0a2', '1.0b1', '1.0rc1', '1.0', '1.0.post1']);
    expect(pep440.best(['1.9', '1.10', '2.0b1'], '')).toBe('1.10');
  });
});

describe('markers', () => {
  const env = markers.deviceEnv('ios');
  it.each([
    ["python_version >= '3.8'", true],
    ["python_version < '3.10'", false],
    ["sys_platform == 'win32'", false],
    ["sys_platform != 'win32' and python_version >= '3.7'", true],
    ["(os_name == 'nt' or platform_system == 'iOS') and implementation_name == 'cpython'", true],
    ["extra == 'socks'", false],
    ["'ios' in sys_platform", true],
  ])('%s -> %s', (marker, expected) => {
    expect(markers.evaluate(marker, env)).toBe(expected);
  });

  it('parses requirements in both styles', () => {
    expect(parseRequirement('urllib3 (<3,>=1.21.1)')).toEqual({ name: 'urllib3', extras: [], spec: '<3,>=1.21.1', marker: '' });
    expect(parseRequirement('PySocks!=1.5.7,>=1.5.6; extra == "socks"')).toEqual({ name: 'PySocks', extras: [], spec: '!=1.5.7,>=1.5.6', marker: 'extra == "socks"' });
    expect(parseRequirement('requests[socks]>=2')).toMatchObject({ name: 'requests', extras: ['socks'], spec: '>=2' });
  });
});

describe('zip', () => {
  it('reads deflated wheel entries', () => {
    const files = zip.entries(wheel({ 'pkg/__init__.py': 'X = 1\n', 'pkg-1.0.dist-info/METADATA': 'Name: pkg\n' }));
    expect(files.map((f: { name: string }) => f.name).sort()).toEqual(['pkg-1.0.dist-info/METADATA', 'pkg/__init__.py']);
    expect(files.find((f: { name: string }) => f.name === 'pkg/__init__.py').data.toString()).toBe('X = 1\n');
  });
});

describe('install', () => {
  type Release = { version: string; requires?: string[]; files?: Record<string, string>; native?: boolean };
  const index: Record<string, Release[]> = {
    app: [{ version: '1.0', requires: ['helper>=1.0', 'colors[nice]', "winonly; sys_platform == 'win32'"] }],
    helper: [{ version: '1.0' }, { version: '1.2' }, { version: '2.0' }],
    colors: [{ version: '0.5', requires: ["sparkle; extra == 'nice'"], files: { 'colors-0.5.data/purelib/colors_extra.py': 'EXTRA = True\n' } }],
    sparkle: [{ version: '3.1' }],
    winonly: [{ version: '1.0' }],
    numpyish: [{ version: '2.0', native: true }],
  };
  const wheels = new Map<string, Buffer>();
  // Recorded when a wheel is first built, like PyPI publishing it.
  const digests = new Map<string, string>();
  let server: http.Server;
  let base: string;

  const record = (name: string, version: string, files: string[]) =>
    [...files, `${name}-${version}.dist-info/METADATA`, `${name}-${version}.dist-info/RECORD`].map((f) => `${f},,`).join('\n');

  function releaseFiles(name: string, r: Release) {
    const key = `/files/${name}-${r.version}.whl`;
    if (!wheels.has(key)) {
      const files: Record<string, string> = { [`${name}/__init__.py`]: `VERSION = "${r.version}"\n`, ...(r.files ?? {}) };
      const installedPaths = Object.keys(files).map((f) => f.replace(/^[^/]+\.data\/purelib\//, ''));
      files[`${name}-${r.version}.dist-info/METADATA`] = `Name: ${name}\nVersion: ${r.version}\n`;
      files[`${name}-${r.version}.dist-info/RECORD`] = record(name, r.version, installedPaths);
      const data = wheel(files);
      wheels.set(key, data);
      digests.set(key, crypto.createHash('sha256').update(data).digest('hex'));
    }
    const filename = r.native ? `${name}-${r.version}-cp315-cp315-ios_arm64.whl` : `${name}-${r.version}-py3-none-any.whl`;
    return [{ filename, url: `${base}${key}`, yanked: false, digests: { sha256: digests.get(key) } }];
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/files/')) {
        const body = wheels.get(url);
        return void res.writeHead(body ? 200 : 404).end(body);
      }
      const m = /^\/pypi\/([^/]+)\/(?:([^/]+)\/)?json$/.exec(url);
      const releases = m && index[m[1]];
      if (!m || !releases) return void res.writeHead(404).end();
      const latest = releases[releases.length - 1];
      const pick = m[2] ? releases.find((r) => r.version === m[2])! : latest;
      const doc = {
        info: { name: m[1], version: pick.version, requires_dist: pick.requires ?? null },
        releases: Object.fromEntries(releases.map((r) => [r.version, releaseFiles(m[1], r)])),
      };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(doc));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('resolves dependencies, extras and markers into .pylibs', async () => {
    const projectDir = tmp();
    const lines: string[] = [];
    await install({ projectDir, requirements: ['app'], index: base, platform: 'ios', log: (l: string) => lines.push(l) });
    const libs = path.join(projectDir, '.pylibs');
    const names = list({ projectDir }).map((p: { name: string; version: string }) => `${p.name} ${p.version}`);
    // helper>=1.0 picks the newest, sparkle comes from colors[nice], winonly is skipped on iOS.
    expect(names).toEqual(['app 1.0', 'colors 0.5', 'helper 2.0', 'sparkle 3.1']);
    expect(fs.readFileSync(path.join(libs, 'colors_extra.py'), 'utf8')).toBe('EXTRA = True\n');
    expect(fs.existsSync(path.join(libs, 'colors-0.5.data'))).toBe(false);
    expect(lines[lines.length - 1]).toMatch(/^Added 4 packages to \.pylibs/);
  });

  it('upgrades by removing the old files and skips what is already there', async () => {
    const projectDir = tmp();
    await install({ projectDir, requirements: ['helper==1.0'], index: base, log: () => {} });
    await install({ projectDir, requirements: ['helper>=1.2'], index: base, log: () => {} });
    const libs = path.join(projectDir, '.pylibs');
    expect(fs.existsSync(path.join(libs, 'helper-1.0.dist-info'))).toBe(false);
    expect(fs.readFileSync(path.join(libs, 'helper/__init__.py'), 'utf8')).toBe('VERSION = "2.0"\n');
    const again = await install({ projectDir, requirements: ['helper'], index: base, log: () => {} });
    expect(again.added).toBe(0);
  });

  it('refuses packages that only have native wheels', async () => {
    await expect(install({ projectDir: tmp(), requirements: ['numpyish'], index: base, log: () => {} })).rejects.toThrow(
      'numpyish 2.0 has no pure-Python wheel',
    );
    await expect(install({ projectDir: tmp(), requirements: ['nope'], index: base, log: () => {} })).rejects.toThrow('nope: not found on PyPI');
  });

  it('rejects a wheel whose checksum does not match', async () => {
    // Publish sparkle (records its digest), then swap the bytes being served.
    await install({ projectDir: tmp(), requirements: ['sparkle'], index: base, log: () => {} });
    const good = wheels.get('/files/sparkle-3.1.whl')!;
    wheels.set('/files/sparkle-3.1.whl', Buffer.from('tampered'));
    try {
      await expect(install({ projectDir: tmp(), requirements: ['sparkle'], index: base, log: () => {} })).rejects.toThrow('sparkle 3.1: checksum mismatch');
    } finally {
      wheels.set('/files/sparkle-3.1.whl', good);
    }
  });

  it('uninstalls by RECORD', async () => {
    const projectDir = tmp();
    await install({ projectDir, requirements: ['sparkle'], index: base, log: () => {} });
    uninstall({ projectDir, names: ['sparkle'], log: () => {} });
    expect(list({ projectDir })).toEqual([]);
    expect(fs.existsSync(path.join(projectDir, '.pylibs', 'sparkle'))).toBe(false);
  });
});
