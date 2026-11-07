import { createMemoryFs } from '../files/memoryFs';
import { createFsStorage } from '../../state/storage';
import { APPROVALS_KEY, createApprovals, LEGACY_APPROVALS_KEY } from './approvals';
import type { Identify } from './projectIdentity';

describe('command approvals', () => {
  const ids = new Map<string, string>();
  const identify: Identify = async (project) => ids.get(project) ?? null;
  beforeEach(() => {
    ids.clear();
    ids.set('web', 'born-1');
  });

  it('are kept across launches', async () => {
    const storage = createFsStorage(createMemoryFs());
    await createApprovals(storage, identify).setAllowed('web', 'npm', true);
    const again = createApprovals(storage, identify);
    expect(await again.isAllowed('web', 'npm')).toBe(true);
    expect(await again.isAllowed('web', 'pip')).toBe(false);
    expect(await again.isAllowed('other', 'npm')).toBe(false);
  });

  it('move with a rename and go with a delete', async () => {
    const approvals = createApprovals(createFsStorage(createMemoryFs()), identify);
    await approvals.setAllowed('web', 'npm', true);
    await approvals.renameProject('web', 'site');
    ids.set('site', 'born-1');
    expect(await approvals.isAllowed('site', 'npm')).toBe(true);
    ids.set('web', 'born-9');
    expect(await approvals.isAllowed('web', 'npm')).toBe(false);
    await approvals.forget('site');
    expect(await approvals.isAllowed('site', 'npm')).toBe(false);
  });

  it("aren't inherited by a different project with the same name", async () => {
    const approvals = createApprovals(createFsStorage(createMemoryFs()), identify);
    await approvals.setAllowed('web', 'npm', true);
    // Deleted in the Files app and another clone dropped in under the name.
    ids.set('web', 'born-2');
    expect(await approvals.isAllowed('web', 'npm')).toBe(false);
    // Gone for good, even if the old folder came back.
    ids.set('web', 'born-1');
    expect(await approvals.isAllowed('web', 'npm')).toBe(false);
  });

  it('can all be reset', async () => {
    const approvals = createApprovals(createFsStorage(createMemoryFs()), identify);
    await approvals.setAllowed('web', 'npm', true);
    await approvals.setAllowed('web', 'pip', true);
    expect(await approvals.count()).toBe(2);
    await approvals.clearAll();
    expect(await approvals.count()).toBe(0);
    expect(await approvals.isAllowed('web', 'npm')).toBe(false);
  });

  it('carries over the old list, taking the identity on first use', async () => {
    const fs = createMemoryFs();
    const storage = createFsStorage(fs);
    await storage.setItem(LEGACY_APPROVALS_KEY, JSON.stringify({ web: ['npm'] }));
    const approvals = createApprovals(storage, identify);
    expect(await approvals.isAllowed('web', 'npm')).toBe(true);
    expect(await storage.getItem(LEGACY_APPROVALS_KEY)).toBeNull();
    expect(JSON.parse((await storage.getItem(APPROVALS_KEY))!).web).toEqual({ id: 'born-1', keys: ['npm'] });
    ids.set('web', 'born-2');
    expect(await approvals.isAllowed('web', 'npm')).toBe(false);
  });
});
