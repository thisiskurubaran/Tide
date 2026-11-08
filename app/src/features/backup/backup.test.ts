import { zipSync } from 'fflate';

import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { AUTO_INTERVAL_MS, createSnapshots, KEEP } from './snapshots';
import { fromBase64, SNAPSHOT_FILE_LIMIT, LEGACY_SNAPSHOT_MANIFEST, SNAPSHOT_MANIFEST, toBase64, writeEntries, zipEntries, zipProject } from './zip';

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
    expect(zipEntries(zip, { stripTopFolder: true }).map((e) => e.path).sort()).toEqual(['README.md', 'src/x.py']);
    // Off by default: a snapshot of a project whose files all live in one folder keeps it.
    expect(zipEntries(zip).map((e) => e.path).sort()).toEqual(['repo-main/README.md', 'repo-main/src/x.py']);
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

  it('never deletes files too big to be in the snapshot', async () => {
    const { workspace, snapshots, tick } = await setup();
    const big = toBase64(new Uint8Array(SNAPSHOT_FILE_LIMIT + 1));
    await workspace.writeBase64('p', 'data/big.bin', big);
    const first = await snapshots.take('p', 'manual');
    tick(1000);
    await snapshots.restore('p', first.id);
    expect(await workspace.readBase64('p', 'data/big.bin')).toBe(big);
    // The manifest is snapshot bookkeeping, not a project file.
    expect(await workspace.stat('p', LEGACY_SNAPSHOT_MANIFEST)).toBeNull();
    // And undoing the restore (whose snapshot skipped it too) keeps it.
    const [undo] = await snapshots.list('p');
    await snapshots.restore('p', undo.id);
    expect(await workspace.readBase64('p', 'data/big.bin')).toBe(big);
  });

  it('keeps big files when restoring an old snapshot with no manifest', async () => {
    const { fs, workspace, snapshots } = await setup();
    // Snapshots from before the manifest: just the files.
    const { zip } = await zipProject(workspace, 'p', { maxFileBytes: SNAPSHOT_FILE_LIMIT });
    await fs.writeBase64('.tide/snapshots/p/5-manual.zip', toBase64(zip));
    const big = toBase64(new Uint8Array(SNAPSHOT_FILE_LIMIT + 1));
    await workspace.writeBase64('p', 'big.bin', big);
    await workspace.createFile('p', '', 'small.txt', 'added later');
    await snapshots.restore('p', '5-manual.zip');
    expect(await workspace.readBase64('p', 'big.bin')).toBe(big);
    expect(await workspace.stat('p', 'small.txt')).toBeNull();
  });

  it("keeps a project's own .tide-snapshot.json: the manifest can't take its place", async () => {
    const { fs, workspace, snapshots, tick } = await setup();
    await workspace.createFile('p', '', LEGACY_SNAPSHOT_MANIFEST, '{"mine":true}');
    const snap = await snapshots.take('p', 'manual');
    // It's in the snapshot as a file, next to the manifest.
    const zip = fromBase64(await fs.readBase64(`.tide/snapshots/p/${snap.id}`));
    expect(zipEntries(zip).find((e) => e.path === LEGACY_SNAPSHOT_MANIFEST)).toBeDefined();
    expect(zipEntries(zip).some((e) => e.path === SNAPSHOT_MANIFEST)).toBe(false);
    await workspace.writeFile('p', LEGACY_SNAPSHOT_MANIFEST, 'changed');
    tick(1000);
    await snapshots.restore('p', snap.id);
    expect(await workspace.readFile('p', LEGACY_SNAPSHOT_MANIFEST)).toBe('{"mine":true}');

    // An older snapshot, whose manifest had that name, doesn't delete it either.
    const old = zipSync({ 'src/a.js': new Uint8Array(Buffer.from('one\n')), [LEGACY_SNAPSHOT_MANIFEST]: new Uint8Array(Buffer.from('{"version":1,"skipped":[]}')) });
    await fs.writeBase64('.tide/snapshots/p/5-manual.zip', toBase64(old));
    await snapshots.restore('p', '5-manual.zip');
    expect(await workspace.readFile('p', LEGACY_SNAPSHOT_MANIFEST)).toBe('{"mine":true}');
  });

  it('restores a project whose files all live under one folder without moving them', async () => {
    const fs = createMemoryFs();
    const workspace = createWorkspace(fs);
    await workspace.createEmptyProject('s');
    await workspace.writeBase64('s', 'site/index.html', toBase64(new Uint8Array(Buffer.from('<p>hi</p>'))));
    await workspace.writeBase64('s', 'site/style.css', toBase64(new Uint8Array(Buffer.from('p{}'))));
    const snapshots = createSnapshots(fs, workspace, () => 1);
    const snap = await snapshots.take('s', 'manual');
    await workspace.writeFile('s', 'site/index.html', 'changed');
    await snapshots.restore('s', snap.id);
    expect((await workspace.listFiles('s')).sort()).toEqual(['site/index.html', 'site/style.css']);
    expect(await workspace.readFile('s', 'site/index.html')).toBe('<p>hi</p>');
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
