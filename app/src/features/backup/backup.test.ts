import { zipSync } from 'fflate';

import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { AUTO_INTERVAL_MS, createSnapshots, KEEP } from './snapshots';
import { fromBase64, toBase64, writeEntries, zipEntries, zipProject } from './zip';

async function setup() {
  const fs = createMemoryFs();
  const workspace = createWorkspace(fs);
  await workspace.createProject('p', 'node-hello');
  await workspace.createFolder('p', '', 'src');
  await workspace.createFile('p', 'src', 'a.js', 'one\n');
  await workspace.writeBase64('p', 'logo.png', toBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128])));
  await workspace.createFolder('p', '', 'node_modules');
  await workspace.createFile('p', 'node_modules', 'big.js', 'x');
  let clock = 1_000_000;
  const snapshots = createSnapshots(fs, workspace, () => clock);
  return { fs, workspace, snapshots, tick: (ms: number) => (clock += ms) };
}

describe('base64', () => {
  it('round-trips bytes like Buffer', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'héllo 😀']) {
      const bytes = new Uint8Array(Buffer.from(s, 'utf8'));
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
      expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
    }
  });
});

describe('zip', () => {
  it('exports a project without rebuildable folders, binary files intact', async () => {
    const { workspace } = await setup();
    const { zip, files } = await zipProject(workspace, 'p');
    const paths = zipEntries(zip).map((e) => e.path).sort();
    expect(paths).toEqual(expect.arrayContaining(['logo.png', 'src/a.js', 'tide.json']));
    expect(paths.some((p) => p.startsWith('node_modules'))).toBe(false);
    expect(files).toBe(paths.length);
    const logo = zipEntries(zip).find((e) => e.path === 'logo.png')!;
    expect([...logo.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0, 255, 128]);
  });

  it('imports a GitHub-style zip, dropping its top folder and anything unsafe', () => {
    const zip = zipSync({
      'repo-main/README.md': new Uint8Array([104, 105]),
      'repo-main/src/x.py': new Uint8Array([49]),
      'repo-main/src/': new Uint8Array(),
      '__MACOSX/repo-main/._README.md': new Uint8Array([0]),
    });
    expect(zipEntries(zip).map((e) => e.path).sort()).toEqual(['README.md', 'src/x.py']);
    expect(zipEntries(zipSync({ 'a/../../etc/passwd': new Uint8Array([1]), 'ok.txt': new Uint8Array([1]) })).map((e) => e.path)).toEqual(['ok.txt']);
    expect(() => zipEntries(new Uint8Array([1, 2, 3]))).toThrow('Not a zip file');
  });

  it('writes imported entries into a project', async () => {
    const { workspace } = await setup();
    await writeEntries(workspace, 'p', [{ path: 'deep/new.txt', bytes: new Uint8Array([104, 105]) }]);
    expect(await workspace.readFile('p', 'deep/new.txt')).toBe('hi');
  });
});

describe('snapshots', () => {
  it('takes one automatically at most every interval', async () => {
    const { snapshots, tick } = await setup();
    expect(await snapshots.maybeTake('p')).toMatchObject({ reason: 'auto' });
    tick(AUTO_INTERVAL_MS - 1);
    expect(await snapshots.maybeTake('p')).toBeNull();
    tick(2);
    expect(await snapshots.maybeTake('p')).not.toBeNull();
    expect((await snapshots.list('p')).map((s) => s.reason)).toEqual(['auto', 'auto']);
  });

  it('restores files, removes ones added since, and can undo the restore', async () => {
    const { workspace, snapshots, tick } = await setup();
    const first = await snapshots.take('p', 'manual');
    tick(1000);
    await workspace.writeFile('p', 'src/a.js', 'changed\n');
    await workspace.createFile('p', '', 'later.txt', 'new');
    await snapshots.restore('p', first.id);
    expect(await workspace.readFile('p', 'src/a.js')).toBe('one\n');
    expect(await workspace.stat('p', 'later.txt')).toBeNull();
    // node_modules wasn't in the snapshot and is left alone.
    expect(await workspace.readFile('p', 'node_modules/big.js')).toBe('x');
    const [undo] = await snapshots.list('p');
    expect(undo.reason).toBe('before-restore');
    await snapshots.restore('p', undo.id);
    expect(await workspace.readFile('p', 'src/a.js')).toBe('changed\n');
  });

  it('keeps fewer when the limit is lowered (free accounts)', async () => {
    const { snapshots, tick } = await setup();
    snapshots.setKeep(3);
    for (let i = 0; i < 5; i++) {
      tick(1000);
      await snapshots.take('p', 'manual');
    }
    expect(await snapshots.list('p')).toHaveLength(3);
  });

  it('keeps the newest few and follows renamed projects', async () => {
    const { snapshots, tick } = await setup();
    for (let i = 0; i < KEEP + 3; i++) {
      tick(1000);
      await snapshots.take('p', 'manual');
    }
    const list = await snapshots.list('p');
    expect(list).toHaveLength(KEEP);
    expect(list[0].time).toBeGreaterThan(list[KEEP - 1].time);
    await snapshots.renameProject('p', 'q');
    expect(await snapshots.list('q')).toHaveLength(KEEP);
    await snapshots.removeProject('q');
    expect(await snapshots.list('q')).toEqual([]);
  });
});
