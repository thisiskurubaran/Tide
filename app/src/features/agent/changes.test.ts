import { createMemoryFs } from '../files/memoryFs';
import { hydrated } from '../../state/hydrated';
import { createFsStorage } from '../../state/storage';
import { CHANGES_STORAGE_KEY, ChangeConflictError, changeHunks, countLines, createChangesStore, diffStats } from './changes';
import type { Identify } from './projectIdentity';
import { memoryProject } from './testUtils';

const P = 'demo';
const lines = (n: number, edit: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => `${edit[i + 1] ?? `line ${i + 1}`}\n`).join('');

// Two changes far enough apart to be separate hunks.
const before = lines(20);
const after = lines(20, { 2: 'TWO', 18: 'EIGHTEEN' });

function staged() {
  const p = memoryProject({ 'a.txt': before });
  p.changes.getState().stage(P, 'a.txt', before, after);
  return p;
}

const change = (p: ReturnType<typeof memoryProject>, path = 'a.txt') => p.changes.getState().byProject[P]?.[path];

describe('pending changes', () => {
  it('stages without touching disk and splits into hunks', () => {
    const p = staged();
    expect(p.writes).toEqual([]);
    const c = change(p)!;
    expect(c.original).toBe(before);
    const hunks = changeHunks(c);
    expect(hunks).toHaveLength(2);
    expect(countLines(hunks)).toEqual({ added: 2, removed: 2 });
  });

  it('keeps the first edit original when the agent edits again', () => {
    const p = staged();
    const again = lines(20, { 2: 'TWO', 18: 'EIGHTEEN', 10: 'TEN' });
    p.changes.getState().stage(P, 'a.txt', 'ignored', again);
    expect(change(p)!.original).toBe(before);
    expect(changeHunks(change(p)!)).toHaveLength(3);
  });

  it('drops a change that is edited back to the original', () => {
    const p = staged();
    p.changes.getState().stage(P, 'a.txt', null, before);
    expect(change(p)).toBeUndefined();
  });

  it('keeps one hunk: written to disk, the other still pending', async () => {
    const p = staged();
    await p.changes.getState().keepHunk(P, 'a.txt', 0);
    expect(p.disk.get('a.txt')).toBe(lines(20, { 2: 'TWO' }));
    const c = change(p)!;
    expect(changeHunks(c)).toHaveLength(1);
    expect(c.proposed).toBe(after);
    // Then the other: resolved, history recorded once with the final text.
    await p.changes.getState().keepHunk(P, 'a.txt', 0);
    expect(change(p)).toBeUndefined();
    expect(p.disk.get('a.txt')).toBe(after);
    expect(p.history).toEqual([['a.txt', after, before]]);
  });

  it('rejects one hunk: disk untouched, the proposal loses that hunk', async () => {
    const p = staged();
    await p.changes.getState().rejectHunk(P, 'a.txt', 1);
    expect(p.writes).toEqual([]);
    expect(change(p)!.proposed).toBe(lines(20, { 2: 'TWO' }));
    await p.changes.getState().rejectHunk(P, 'a.txt', 0);
    expect(change(p)).toBeUndefined();
    expect(p.disk.get('a.txt')).toBe(before);
    expect(p.history).toEqual([]);
  });

  it('keeps and rejects whole files', async () => {
    const p = memoryProject({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
    p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    p.changes.getState().stage(P, 'b.txt', 'b\n', 'B\n');
    await p.changes.getState().keepFile(P, 'a.txt');
    await p.changes.getState().rejectFile(P, 'b.txt');
    expect(p.disk.get('a.txt')).toBe('A\n');
    expect(p.disk.get('b.txt')).toBe('b\n');
    expect(p.changes.getState().byProject[P]).toEqual({});
  });

  it('creates new files on keep and never writes rejected ones', async () => {
    const p = memoryProject();
    p.changes.getState().stage(P, 'src/new.js', null, 'x\n');
    p.changes.getState().stage(P, 'other.js', null, 'y\n');
    expect(changeHunks(change(p, 'src/new.js')!)).toHaveLength(1);
    await p.changes.getState().keepHunk(P, 'src/new.js', 0);
    await p.changes.getState().rejectHunk(P, 'other.js', 0);
    expect(p.disk.get('src/new.js')).toBe('x\n');
    expect(p.disk.has('other.js')).toBe(false);
    expect(p.writes).toEqual([['src/new.js', 'x\n']]);
  });

  it('keep all and undo all', async () => {
    const p = memoryProject({ 'a.txt': 'a\n' });
    p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    p.changes.getState().stage(P, 'n.txt', null, 'n\n');
    await p.changes.getState().keepAll(P);
    expect(Object.fromEntries(p.disk)).toEqual({ 'a.txt': 'A\n', 'n.txt': 'n\n' });

    const q = memoryProject({ 'a.txt': 'a\n' });
    q.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    q.changes.getState().stage(P, 'n.txt', null, 'n\n');
    await q.changes.getState().undoAll(P);
    expect(Object.fromEntries(q.disk)).toEqual({ 'a.txt': 'a\n' });
    expect(q.writes).toEqual([]);
  });

  describe('applied for a command', () => {
    it('writes proposals to disk, and rejecting restores the original', async () => {
      const p = memoryProject({ 'a.txt': before });
      p.changes.getState().stage(P, 'a.txt', before, after);
      p.changes.getState().stage(P, 'n.txt', null, 'new\n');
      await p.changes.getState().applyToDisk(P);
      expect(p.disk.get('a.txt')).toBe(after);
      expect(p.disk.get('n.txt')).toBe('new\n');
      // Still pending review.
      expect(Object.keys(p.changes.getState().byProject[P])).toHaveLength(2);

      // Rejecting one hunk takes it off disk; the other stays applied.
      await p.changes.getState().rejectHunk(P, 'a.txt', 0);
      expect(p.disk.get('a.txt')).toBe(lines(20, { 18: 'EIGHTEEN' }));
      await p.changes.getState().rejectFile(P, 'a.txt');
      await p.changes.getState().rejectFile(P, 'n.txt');
      expect(p.disk.get('a.txt')).toBe(before);
      expect(p.disk.has('n.txt')).toBe(false);
    });

    it('keeping an applied change needs no write', async () => {
      const p = memoryProject({ 'a.txt': 'a\n' });
      p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
      await p.changes.getState().applyToDisk(P);
      p.writes.length = 0;
      await p.changes.getState().keepAll(P);
      expect(p.writes).toEqual([]);
      expect(p.history).toEqual([['a.txt', 'A\n', 'a\n']]);
    });

    it('picks up what a program wrote to a changed file', async () => {
      const p = memoryProject({ 'a.txt': 'a\n' });
      p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
      await p.changes.getState().applyToDisk(P);
      p.disk.set('a.txt', 'A formatted\n');
      await p.changes.getState().syncFromDisk(P);
      expect(change(p)!.proposed).toBe('A formatted\n');
      await p.changes.getState().rejectFile(P, 'a.txt');
      expect(p.disk.get('a.txt')).toBe('a\n');
    });
  });

  it('refuses to overwrite a file changed behind its back unless forced', async () => {
    const p = memoryProject({ 'a.txt': 'a\n' });
    p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    p.disk.set('a.txt', 'user edit\n');
    await expect(p.changes.getState().keepFile(P, 'a.txt')).rejects.toBeInstanceOf(ChangeConflictError);
    expect(change(p)).toBeDefined();
    await p.changes.getState().keepFile(P, 'a.txt', true);
    expect(p.disk.get('a.txt')).toBe('A\n');
  });

  it('counts +/− between two texts', () => {
    expect(diffStats('a\nb\n', 'a\nB\nc\n')).toEqual({ added: 2, removed: 1 });
    expect(diffStats(null, 'x\ny\n')).toEqual({ added: 2, removed: 0 });
  });
});

describe('pending changes across a relaunch', () => {
  const relaunch = async (p: ReturnType<typeof memoryProject>, storage: ReturnType<typeof createFsStorage>) => {
    const store = createChangesStore(p.io, storage);
    await hydrated(store, 1000);
    return store;
  };

  it('saves applied changes before they reach disk, and Undo restores the originals after a restart', async () => {
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    const p = memoryProject({ 'a.txt': before });
    const first = await relaunch(p, storage);
    first.getState().stage(P, 'a.txt', before, after);
    first.getState().stage(P, 'new.txt', null, 'brand new\n');
    // The saved record exists by the time the first file is written.
    const io = p.io.write;
    let savedAtWrite: string | null = null;
    p.io.write = async (...args) => {
      savedAtWrite ??= await fs.readFile('.tide/agent-changes.json');
      return io(...args);
    };
    await first.getState().applyToDisk(P);
    expect(JSON.parse(savedAtWrite!).state.byProject[P]['a.txt'].original).toBe(before);
    expect(p.disk.get('a.txt')).toBe(after);

    // The app is killed; a new store loads what was saved.
    const second = await relaunch(p, storage);
    expect(Object.keys(second.getState().byProject[P]).sort()).toEqual(['a.txt', 'new.txt']);
    await second.getState().undoAll(P);
    expect(p.disk.get('a.txt')).toBe(before);
    expect(p.disk.has('new.txt')).toBe(false);
    expect(second.getState().byProject[P]).toEqual({});

    // Resolved changes are gone from the record too, once the coalesced save is written.
    await second.getState().flush();
    const third = await relaunch(p, storage);
    expect(third.getState().byProject[P] ?? {}).toEqual({});
  });

  it('keeps a hunk after a restart', async () => {
    const storage = createFsStorage(createMemoryFs());
    const p = memoryProject({ 'a.txt': before });
    const first = await relaunch(p, storage);
    first.getState().stage(P, 'a.txt', before, after);
    await first.getState().applyToDisk(P);
    const second = await relaunch(p, storage);
    await second.getState().keepHunk(P, 'a.txt', 0);
    await second.getState().rejectHunk(P, 'a.txt', 0);
    expect(p.disk.get('a.txt')).toBe(lines(20, { 2: 'TWO' }));
    expect(second.getState().byProject[P]['a.txt']).toBeUndefined();
  });

  it('starts empty from a damaged save', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fs = createMemoryFs();
    await fs.writeFile('.tide/agent-changes.json', '{"state":');
    const store = await relaunch(memoryProject(), createFsStorage(fs));
    expect(store.getState().byProject).toEqual({});
    warn.mockRestore();
  });
});

describe('a crash between writing a file and saving the record', () => {
  const relaunch = async (p: ReturnType<typeof memoryProject>, storage: ReturnType<typeof createFsStorage>) => {
    const store = createChangesStore(p.io, storage);
    await hydrated(store, 1000);
    return store;
  };
  const saved = async (fs: ReturnType<typeof createMemoryFs>) => JSON.parse(await fs.readFile('.tide/agent-changes.json')).state.byProject[P];

  it('rejecting after a relaunch takes the applied edit off disk', async () => {
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    const p = memoryProject({ 'a.txt': 'a\n' });
    const first = await relaunch(p, storage);
    first.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    await first.getState().applyToDisk(P);
    expect(p.disk.get('a.txt')).toBe('A\n');
    // Killed before `disk = proposed` was saved: the record has the intent only.
    expect((await saved(fs))['a.txt']).toMatchObject({ disk: 'a\n', applying: 'A\n' });

    const second = await relaunch(p, storage);
    await second.getState().rejectFile(P, 'a.txt');
    expect(p.disk.get('a.txt')).toBe('a\n');
    expect(second.getState().byProject[P]).toEqual({});
  });

  it('reads the file even when an older record has no intent', async () => {
    const fs = createMemoryFs();
    const record = { path: 'a.txt', original: 'a\n', proposed: 'A\n', disk: 'a\n', base: 'a\n' };
    await fs.writeFile('.tide/agent-changes.json', JSON.stringify({ state: { byProject: { [P]: { 'a.txt': record } } }, version: 1 }));
    const p = memoryProject({ 'a.txt': 'A\n' });
    const store = await relaunch(p, createFsStorage(fs));
    await store.getState().rejectFile(P, 'a.txt');
    expect(p.disk.get('a.txt')).toBe('a\n');
  });

  it('killed before the write: the file is untouched and the change still pending', async () => {
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    const p = memoryProject({ 'a.txt': 'a\n' });
    const first = await relaunch(p, storage);
    first.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    const write = p.io.write;
    p.io.write = async () => {
      throw new Error('killed');
    };
    await expect(first.getState().applyToDisk(P)).rejects.toThrow('killed');
    p.io.write = write;

    const second = await relaunch(p, storage);
    await second.getState().reconcileAll();
    expect(second.getState().byProject[P]['a.txt']).toEqual({ path: 'a.txt', original: 'a\n', proposed: 'A\n', disk: 'a\n', base: 'a\n' });
    await second.getState().rejectFile(P, 'a.txt');
    expect(p.writes).toEqual([]);
    expect(p.disk.get('a.txt')).toBe('a\n');
  });

  it('reconciles disk from the files on load', async () => {
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    const p = memoryProject({ 'a.txt': 'a\n' });
    const first = await relaunch(p, storage);
    first.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    await first.getState().applyToDisk(P);
    const second = await relaunch(p, storage);
    await second.getState().reconcileAll();
    expect(second.getState().byProject[P]['a.txt']).toEqual({ path: 'a.txt', original: 'a\n', proposed: 'A\n', disk: 'A\n', base: 'a\n' });
  });
});

describe('saving pending changes', () => {
  it('coalesces saves, and waits for one before applying to disk', async () => {
    const fs = createMemoryFs();
    const inner = createFsStorage(fs);
    const writes: string[] = [];
    const storage = { ...inner, setItem: async (k: string, v: string) => (writes.push(v), inner.setItem(k, v)) };
    const p = memoryProject({ 'a.txt': 'a\n' });
    const store = createChangesStore(p.io, storage, { saveDelayMs: 10_000 });
    await hydrated(store, 1000);
    for (let i = 0; i < 20; i++) store.getState().stage(P, 'a.txt', 'a\n', `edit ${i}\n`);
    expect(writes).toHaveLength(0);
    await store.getState().flush();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).state.byProject[P]['a.txt'].proposed).toBe('edit 19\n');

    let savedBeforeWrite = 0;
    const write = p.io.write;
    p.io.write = async (...args) => {
      savedBeforeWrite = writes.length;
      return write(...args);
    };
    await store.getState().applyToDisk(P);
    expect(savedBeforeWrite).toBe(2);
    expect(JSON.parse(await fs.readFile(`.tide/${CHANGES_STORAGE_KEY}.json`)).state.byProject[P]['a.txt'].applying).toBe('edit 19\n');
    await store.getState().flush();
  });
});

describe('pending changes follow the project', () => {
  const ids = new Map<string, string>();
  const identify: Identify = async (project) => ids.get(project) ?? null;
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => ids.clear());

  it('move with a rename and go with a delete', async () => {
    ids.set(P, 'born-1');
    const p = memoryProject({ 'a.txt': 'a\n' });
    const store = createChangesStore(p.io, undefined, { identify });
    store.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    await settle();
    expect(store.getState().owners[P]).toBe('born-1');

    store.getState().renameProject(P, 'renamed');
    ids.delete(P);
    ids.set('renamed', 'born-1');
    expect(store.getState().byProject[P]).toBeUndefined();
    expect(store.getState().byProject.renamed['a.txt'].proposed).toBe('A\n');
    await store.getState().reconcile('renamed');
    expect(store.getState().byProject.renamed['a.txt']).toBeDefined();

    store.getState().forget('renamed');
    expect(store.getState().byProject.renamed).toBeUndefined();
    expect(store.getState().owners.renamed).toBeUndefined();
  });

  it("don't come back for a project deleted outside Tide, or a new one with the same name", async () => {
    ids.set(P, 'born-1');
    const p = memoryProject({ 'a.txt': 'a\n' });
    const store = createChangesStore(p.io, undefined, { identify });
    store.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    await settle();

    // Made again in the Files app: a new folder, same name.
    ids.set(P, 'born-2');
    await store.getState().reconcileAll();
    expect(store.getState().byProject[P]).toBeUndefined();

    store.getState().stage(P, 'a.txt', 'a\n', 'B\n');
    await settle();
    // Deleted in the Files app.
    ids.delete(P);
    await store.getState().reconcileAll();
    expect(store.getState().byProject[P]).toBeUndefined();
  });
});
