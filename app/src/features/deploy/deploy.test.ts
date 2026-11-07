jest.mock('expo-secure-store', () => require('../ai/testMocks').secureStoreMock());
jest.mock('../../state', () => ({ projectsStore: { getState: () => ({ projects: ['my app', 'my_app'] }) }, workspace: {} }));
jest.mock('../git/settings', () => ({ gitSettingsStore: { getState: () => ({ settings: { token: '' } }) } }));

import * as SecureStore from 'expo-secure-store';

import { deployHooks, getToken, hookKeys, setToken } from './deploy';

const items = (SecureStore as unknown as { __items: Map<string, string> }).__items;

describe('Render deploy hooks', () => {
  beforeEach(() => items.clear());

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
    await deployHooks.rename('my app', 'site');
    expect(await getToken('render', 'site')).toBe('https://hook/1');
    expect(await getToken('render', 'my app')).toBe('');
    await deployHooks.remove('site');
    expect(items.size).toBe(0);
  });
});
