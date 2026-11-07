import { createMemoryFs } from '../features/files/memoryFs';
import { MAX_RECENT_FILES, createRecentsStore, timeAgo } from './recents';
import { hydrated } from './hydrated';
import { createFsStorage } from './storage';
import { createTabsStore } from './tabs';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  let t = 1000;
  const storage = createFsStorage(createMemoryFs());
  const store = createRecentsStore(storage, () => t++);
  return { storage, store };
}

describe('recents store', () => {
  it('records when each project was opened', () => {
    const { store } = setup();
    store.getState().touchProject('a');
    store.getState().touchProject('b');
    store.getState().touchProject('a');
    expect(store.getState().projects).toEqual({ a: 1002, b: 1001 });
  });

  it('keeps files most recent first, deduped and capped', () => {
    const { store } = setup();
    const s = store.getState();
    s.touchFile('p', 'a.js');
    s.touchFile('p', 'b.js');
    s.touchFile('q', 'a.js');
    s.touchFile('p', 'a.js');
    expect(store.getState().files.map((f) => `${f.project}/${f.path}`)).toEqual(['p/a.js', 'q/a.js', 'p/b.js']);
    for (let i = 0; i < 30; i++) s.touchFile('p', `f${i}.js`);
    expect(store.getState().files).toHaveLength(MAX_RECENT_FILES);
    expect(store.getState().files[0].path).toBe('f29.js');
  });

  it('forgets a project and follows a rename', () => {
    const { store } = setup();
    const s = store.getState();
    s.touchProject('a');
    s.touchProject('b');
    s.touchFile('a', 'x.js');
    s.touchFile('b', 'y.js');
    s.forget('a');
    expect(store.getState().projects).toEqual({ b: 1001 });
    expect(store.getState().files.map((f) => f.project)).toEqual(['b']);
    s.renameProject('b', 'c');
    expect(store.getState().projects).toEqual({ c: 1001 });
    expect(store.getState().files[0]).toMatchObject({ project: 'c', path: 'y.js' });
  });

  it('persists across restarts', async () => {
    const { storage, store } = setup();
    // Changes made before the saved state loads aren't saved (they'd hold defaults).
    await hydrated(store);
    store.getState().touchProject('a');
    store.getState().touchFile('a', 'x.js');
    await flush();
    const again = createRecentsStore(storage);
    await again.persist.rehydrate();
    expect(again.getState().projects).toEqual({ a: 1000 });
    expect(again.getState().files).toEqual([{ project: 'a', path: 'x.js', at: 1001 }]);
  });

  it('hears files opened in tabs', () => {
    const { storage, store } = setup();
    const tabs = createTabsStore(storage, { opened: (p, path) => store.getState().touchFile(p, path) });
    tabs.getState().openTab('p', 'index.html');
    expect(store.getState().files[0]).toMatchObject({ project: 'p', path: 'index.html' });
  });
});

describe('timeAgo', () => {
  const now = Date.UTC(2026, 10, 3, 12);
  it.each([
    [now - 10_000, 'Just now'],
    [now - 2 * 60_000, '2 min ago'],
    [now - 3 * 3_600_000, '3 h ago'],
    [now - 30 * 3_600_000, 'Yesterday'],
    [now - 4 * 86_400_000, '4 days ago'],
  ])('%s reads %s', (at, text) => expect(timeAgo(at, now)).toBe(text));
});
