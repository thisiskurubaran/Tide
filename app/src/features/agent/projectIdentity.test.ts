// The project identity per platform (H2): Android reports a folder's
// last-modified time as its creation time, so it must never be used to drop
// pending changes or approvals there.
import { createMemoryFs } from '../files/memoryFs';
import { hydrated } from '../../state/hydrated';
import { createFsStorage } from '../../state/storage';
import { APPROVALS_KEY, createApprovals } from './approvals';
import { CHANGES_STORAGE_KEY, createChangesStore } from './changes';
import { folderIdentity, identityReliable } from './projectIdentity';
import { memoryProject } from './testUtils';

const mockPlatform = { OS: 'ios' as string };
// A getter: the factory runs on import, before mockPlatform is set.
jest.mock('react-native', () => ({
  get Platform() {
    return mockPlatform;
  },
}));

// Project folders by name: what Directory.info() reports for each.
const mockFolders = new Map<string, number | undefined>();
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///docs' },
  Directory: class {
    private name: string;
    constructor(_base: unknown, path: string) {
      this.name = path.split('/').pop()!;
    }
    info() {
      return mockFolders.has(this.name) ? { exists: true, creationTime: mockFolders.get(this.name) } : { exists: false };
    }
  },
}));
jest.mock('../files/workspace', () => ({ PROJECTS_DIR: 'projects' }));

const P = 'web';
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockFolders.clear();
  mockPlatform.OS = 'ios';
});

describe('folderIdentity', () => {
  it('is the birth time on iOS, and trusted', async () => {
    mockFolders.set(P, 1000.4);
    expect(await folderIdentity(P)).toBe('1000');
    expect(identityReliable(folderIdentity)).toBe(true);
  });

  it('is unknown on Android, where creationTime is the last-modified time', async () => {
    mockPlatform.OS = 'android';
    mockFolders.set(P, 1000);
    expect(await folderIdentity(P)).toBe('');
    expect(identityReliable(folderIdentity)).toBe(false);
  });

  it('is null for a missing folder on both', async () => {
    expect(await folderIdentity(P)).toBeNull();
    mockPlatform.OS = 'android';
    expect(await folderIdentity(P)).toBeNull();
  });
});

describe('on Android', () => {
  beforeEach(() => {
    mockPlatform.OS = 'android';
  });

  it("keeps applied changes and approvals when the folder's mtime changes", async () => {
    mockFolders.set(P, 1000);
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    const p = memoryProject({ 'a.txt': 'a\n' });
    const first = createChangesStore(p.io, storage, { identify: folderIdentity });
    await hydrated(first, 1000);
    first.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    await first.getState().applyToDisk(P);
    await settle();
    await first.getState().flush();
    const approvals = createApprovals(storage, folderIdentity);
    await approvals.setAllowed(P, 'npm', true);

    // A file added at the project root: the folder's "creation time" moves.
    mockFolders.set(P, 2000);
    const second = createChangesStore(p.io, storage, { identify: folderIdentity });
    await hydrated(second, 1000);
    await second.getState().reconcileAll();
    expect(second.getState().byProject[P]['a.txt']).toMatchObject({ original: 'a\n', proposed: 'A\n', disk: 'A\n' });
    expect(await createApprovals(storage, folderIdentity).isAllowed(P, 'npm')).toBe(true);
  });

  it('still drops records when the folder is gone', async () => {
    mockFolders.set(P, 1000);
    const p = memoryProject({ 'a.txt': 'a\n' });
    const store = createChangesStore(p.io, undefined, { identify: folderIdentity });
    store.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    const approvals = createApprovals(createFsStorage(createMemoryFs()), folderIdentity);
    await approvals.setAllowed(P, 'npm', true);
    mockFolders.delete(P);
    await store.getState().reconcileAll();
    expect(store.getState().byProject[P]).toBeUndefined();
    expect(await approvals.isAllowed(P, 'npm')).toBe(false);
  });

  it('loads records saved with a stale mtime identity safely, and clears it', async () => {
    mockFolders.set(P, 5000);
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    // Saved by the old scheme, when the folder's mtime was 1000.
    const change = { path: 'a.txt', original: 'a\n', proposed: 'A\n', disk: 'A\n', base: 'a\n' };
    await storage.setItem(CHANGES_STORAGE_KEY, JSON.stringify({ state: { byProject: { [P]: { 'a.txt': change } }, owners: { [P]: '1000' } }, version: 1 }));
    await storage.setItem(APPROVALS_KEY, JSON.stringify({ [P]: { id: '1000', keys: ['npm'] } }));

    const p = memoryProject({ 'a.txt': 'A\n' });
    const store = createChangesStore(p.io, storage, { identify: folderIdentity });
    await hydrated(store, 1000);
    expect(store.getState().owners[P]).toBeUndefined();
    await store.getState().reconcileAll();
    expect(store.getState().byProject[P]['a.txt']).toEqual(change);
    expect(store.getState().owners[P]).toBeUndefined();
    // It's ignored on every load (and gone with the next save): another launch is fine too.
    mockFolders.set(P, 6000);
    const again = createChangesStore(p.io, storage, { identify: folderIdentity });
    await hydrated(again, 1000);
    await again.getState().reconcileAll();
    expect(again.getState().byProject[P]['a.txt']).toEqual(change);

    const approvals = createApprovals(storage, folderIdentity);
    expect(await approvals.isAllowed(P, 'npm')).toBe(true);
    expect(JSON.parse((await storage.getItem(APPROVALS_KEY))!)[P]).toEqual({ id: '', keys: ['npm'] });
  });
});

describe('on iOS', () => {
  it('a new folder under the same name still loses the old changes and approvals', async () => {
    mockFolders.set(P, 1000);
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    const p = memoryProject({ 'a.txt': 'a\n' });
    const first = createChangesStore(p.io, storage, { identify: folderIdentity });
    await hydrated(first, 1000);
    first.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    await settle();
    expect(first.getState().owners[P]).toBe('1000');
    await first.getState().flush();
    const approvals = createApprovals(storage, folderIdentity);
    await approvals.setAllowed(P, 'npm', true);
    expect(JSON.parse((await storage.getItem(APPROVALS_KEY))!)[P].id).toBe('1000');

    // Deleted in the Files app and made again: a new birth time.
    mockFolders.set(P, 2000);
    const second = createChangesStore(p.io, storage, { identify: folderIdentity });
    await hydrated(second, 1000);
    expect(second.getState().owners[P]).toBe('1000');
    await second.getState().reconcileAll();
    expect(second.getState().byProject[P]).toBeUndefined();
    expect(await createApprovals(storage, folderIdentity).isAllowed(P, 'npm')).toBe(false);
  });
});
