import { createMemoryFs } from '../files/memoryFs';
import { createHistory, KEEP, MERGE_MS } from './history';

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
});
