import { createMemoryFs } from '../files/memoryFs';
import { createHistory, KEEP, MERGE_MS, replacesMost } from './history';

function setup() {
  const fs = createMemoryFs();
  let t = 1_000_000;
  const history = createHistory(fs, () => t);
  return { fs, history, advance: (ms: number) => (t += ms) };
}

describe('local history', () => {
  it('keeps the version before the first save and merges saves close together', async () => {
    const { history, advance } = setup();
    await history.record('p', 'src/a.js', 'one', 'zero');
    advance(800);
    await history.record('p', 'src/a.js', 'one two', 'one');
    advance(800);
    await history.record('p', 'src/a.js', 'one two three', 'one two');
    const versions = await history.list('p', 'src/a.js');
    expect(await Promise.all(versions.map((v) => history.read('p', 'src/a.js', v.id)))).toEqual(['one two three', 'zero']);
  });

  it('starts a new version after the merge window, and skips unchanged saves', async () => {
    const { history, advance } = setup();
    await history.record('p', 'a.txt', 'v1');
    advance(MERGE_MS + 1);
    await history.record('p', 'a.txt', 'v2', 'v1');
    advance(MERGE_MS + 1);
    await history.record('p', 'a.txt', 'v2', 'v2');
    const versions = await history.list('p', 'a.txt');
    expect(await Promise.all(versions.map((v) => history.read('p', 'a.txt', v.id)))).toEqual(['v2', 'v1']);
  });

  it(`keeps the newest ${KEEP} versions and ignores huge or binary files`, async () => {
    const { history, advance } = setup();
    for (let i = 0; i < KEEP + 5; i++) {
      advance(MERGE_MS + 1);
      await history.record('p', 'a.txt', `v${i}`);
    }
    const versions = await history.list('p', 'a.txt');
    expect(versions).toHaveLength(KEEP);
    expect(await history.read('p', 'a.txt', versions[0].id)).toBe(`v${KEEP + 4}`);
    await history.record('p', 'big.txt', 'x'.repeat(2 * 1024 * 1024));
    await history.record('p', 'bin.dat', 'a\u0000b');
    expect(await history.list('p', 'big.txt')).toEqual([]);
    expect(await history.list('p', 'bin.dat')).toEqual([]);
  });

  it('follows renamed files and projects, and goes away with the project', async () => {
    const { history } = setup();
    await history.record('p', 'dir/a.txt', 'hello');
    await history.renamePath('p', 'dir/a.txt', 'dir/b.txt');
    expect(await history.list('p', 'dir/a.txt')).toEqual([]);
    expect(await history.list('p', 'dir/b.txt')).toHaveLength(1);
    await history.renameProject('p', 'q');
    expect(await history.list('q', 'dir/b.txt')).toHaveLength(1);
    await history.removeProject('q');
    expect(await history.list('q', 'dir/b.txt')).toEqual([]);
  });

  const texts = async (history: ReturnType<typeof setup>['history'], path: string) =>
    Promise.all((await history.list('p', path)).map((v) => history.read('p', path, v.id)));

  it('anchors the merge window to when the version started, so continuous editing still adds versions', async () => {
    const { history, advance } = setup();
    await history.record('p', 'a.txt', 'v0');
    let text = 'v0';
    // A save every 30 s for 5 minutes.
    for (let i = 1; i <= 10; i++) {
      advance(30_000);
      const before = text;
      text = `${text}+${i}`;
      await history.record('p', 'a.txt', text, before);
    }
    const versions = await history.list('p', 'a.txt');
    expect(versions.length).toBeGreaterThanOrEqual(3);
    expect(versions[0].created).toBeLessThan(versions[0].time);
    expect(await history.read('p', 'a.txt', versions[0].id)).toBe(text);
  });

  it('keeps the text a save replaces most of (select all and delete), even inside the merge window', async () => {
    const { history, advance } = setup();
    await history.record('p', 'a.txt', 'line one\nline two\n');
    advance(1000);
    await history.record('p', 'a.txt', 'line one\nline two\nline three\n', 'line one\nline two\n');
    advance(1000);
    await history.record('p', 'a.txt', '', 'line one\nline two\nline three\n');
    expect(await texts(history, 'a.txt')).toEqual(['', 'line one\nline two\nline three\n']);
  });

  it('keeps the text a restore replaces, as a version of its own', async () => {
    const { history, advance } = setup();
    await history.record('p', 'a.txt', 'old');
    advance(MERGE_MS + 1);
    await history.record('p', 'a.txt', 'old and new', 'old');
    advance(1000);
    // Restoring "old" changes little text, but is kept apart.
    history.keepNext('p', 'a.txt');
    await history.record('p', 'a.txt', 'old', 'old and new');
    expect(await texts(history, 'a.txt')).toEqual(['old', 'old and new', 'old']);
    // Only that one save.
    advance(1000);
    await history.record('p', 'a.txt', 'old!', 'old');
    expect(await texts(history, 'a.txt')).toEqual(['old!', 'old and new', 'old']);
  });

  it('measures how much of a text a change replaces', () => {
    expect(replacesMost('abcdef', '')).toBe(true);
    expect(replacesMost('abcdef', 'abcdefg')).toBe(false);
    expect(replacesMost('abcdef', 'abcXef')).toBe(false);
    expect(replacesMost('abcdef', 'zzzzzz')).toBe(true);
    expect(replacesMost('', 'anything')).toBe(false);
  });

  it('moves the history of every file under a renamed folder, and drops unrelated versions at the new path', async () => {
    const { history } = setup();
    await history.record('p', 'src/a.js', 'a');
    await history.record('p', 'src/sub/b.js', 'b');
    await history.record('p', 'lib/a.js', 'an older, deleted lib/a.js');
    await history.record('p', 'srcx.js', 'not under src');
    await history.renamePath('p', 'src', 'lib');
    expect(await texts(history, 'lib/a.js')).toEqual(['a']);
    expect(await texts(history, 'lib/sub/b.js')).toEqual(['b']);
    expect(await history.list('p', 'src/a.js')).toEqual([]);
    expect(await texts(history, 'srcx.js')).toEqual(['not under src']);
  });

  it('removes the history of a deleted file or folder', async () => {
    const { history } = setup();
    await history.record('p', 'dir/a.txt', 'a');
    await history.record('p', 'dir/b.txt', 'b');
    await history.record('p', 'keep.txt', 'k');
    await history.removePath('p', 'dir');
    expect(await history.list('p', 'dir/a.txt')).toEqual([]);
    expect(await history.list('p', 'dir/b.txt')).toEqual([]);
    expect(await history.list('p', 'keep.txt')).toHaveLength(1);
  });
});
