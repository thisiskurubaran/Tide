jest.mock('expo-secure-store', () => require('../ai/testMocks').secureStoreMock());
jest.mock('../../state', () => ({ projectsStore: { getState: () => ({ projects: ['my app', 'my_app', 'site'], loaded: true }) }, workspace: {} }));
// Folder identities by project name ('' unknown, absent: no such folder).
const mockIds = new Map<string, string>();
jest.mock('../agent/projectIdentity', () => ({
  ...jest.requireActual('../agent/projectIdentity'),
  folderIdentity: Object.assign(async (p: string) => mockIds.get(p) ?? null, { reliable: () => true }),
}));
jest.mock('../git/settings', () => ({ gitSettingsStore: { getState: () => ({ settings: { token: '' } }) } }));

import * as SecureStore from 'expo-secure-store';

import { deployHooks, getToken, hookKeys, setToken } from './deploy';

const items = (SecureStore as unknown as { __items: Map<string, string> }).__items;

describe('Render deploy hooks', () => {
  beforeEach(() => {
    items.clear();
    mockIds.clear();
    for (const p of ['my app', 'my_app', 'site']) mockIds.set(p, `born-${p}`);
  });

  it('are kept per project, even for names the old key mixed up', async () => {
    expect(hookKeys.legacy('my app')).toBe(hookKeys.legacy('my_app'));
    await setToken('render', 'my app', ' https://hook/1 ');
    await setToken('render', 'my_app', 'https://hook/2');
    expect(await getToken('render', 'my app')).toBe('https://hook/1');
    expect(await getToken('render', 'my_app')).toBe('https://hook/2');
    for (const key of items.keys()) expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('follow a rename and go with a delete', async () => {
    await setToken('render', 'my app', 'https://hook/1');
    // The folder moves, keeping its identity.
    mockIds.set('site', mockIds.get('my app')!);
    mockIds.delete('my app');
    await deployHooks.rename('my app', 'site');
    expect(await getToken('render', 'site')).toBe('https://hook/1');
    expect(await getToken('render', 'my app')).toBe('');
    await deployHooks.remove('site');
    expect(items.size).toBe(0);
  });

  it("aren't inherited by a project made again under a deleted one's name", async () => {
    await setToken('render', 'site', 'https://hook/1');
    // Deleted in the Files app and made again.
    mockIds.set('site', 'born-again');
    expect(await getToken('render', 'site')).toBe('');
  });
});
