import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { commandArgs, commandLine, detectEcosystems, Fetch, isNewer, latestVersion, npmInstalled, pipInstalled, searchNpm, searchPip } from './packages';

const respond = (routes: Record<string, unknown>): Fetch => async (url) => {
  const body = routes[url];
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
};

async function project() {
  const workspace = createWorkspace(createMemoryFs());
  await workspace.createEmptyProject('p');
  return workspace;
}

describe('package manager', () => {
  it('lists npm dependencies with what is installed', async () => {
    const ws = await project();
    await ws.writeBase64('p', 'package.json', Buffer.from(JSON.stringify({ dependencies: { lodash: '^4.17.0', left: '^1.0.0' }, devDependencies: { jest: '^29.0.0' } })).toString('base64'));
    await ws.writeBase64('p', 'node_modules/lodash/package.json', Buffer.from('{"version":"4.17.21"}').toString('base64'));
    expect(await npmInstalled(ws, 'p')).toEqual([
      { name: 'jest', wanted: '^29.0.0', version: null, dev: true },
      { name: 'left', wanted: '^1.0.0', version: null, dev: false },
      { name: 'lodash', wanted: '^4.17.0', version: '4.17.21', dev: false },
    ]);
    expect(await detectEcosystems(ws, 'p')).toEqual(['npm']);
  });

  it('lists pip packages from .pylibs and requirements.txt', async () => {
    const ws = await project();
    await ws.createFolder('p', '', '.pylibs');
    await ws.createFolder('p', '.pylibs', 'six-1.16.0.dist-info');
    await ws.createFolder('p', '.pylibs', 'typing_extensions-4.12.2.dist-info');
    await ws.createFile('p', '', 'requirements.txt', '# deps\nSix>=1.15\nrequests[socks]==2.32.0 ; python_version > "3"\n');
    expect(await pipInstalled(ws, 'p')).toEqual([
      { name: 'requests', version: null, wanted: '==2.32.0', dev: false },
      { name: 'six', version: '1.16.0', wanted: '>=1.15', dev: false },
      { name: 'typing-extensions', version: '4.12.2', wanted: null, dev: false },
    ]);
    expect(await detectEcosystems(ws, 'p')).toEqual(['pip']);
  });

  it('searches the registries', async () => {
    const fetch = respond({
      'https://registry.npmjs.org/-/v1/search?text=left%20pad&size=20': { objects: [{ package: { name: 'left-pad', version: '1.3.0', description: 'pad' } }] },
      'https://pypi.org/pypi/requests/json': { info: { name: 'requests', version: '2.32.3', summary: 'HTTP' } },
      'https://registry.npmjs.org/@scope%2Fpkg/latest': { version: '2.0.0' },
    });
    expect(await searchNpm('left pad', fetch)).toEqual([{ name: 'left-pad', version: '1.3.0', description: 'pad' }]);
    expect(await searchPip('Requests', fetch)).toEqual([{ name: 'requests', version: '2.32.3', description: 'HTTP' }]);
    expect(await searchPip('nothing-here', fetch)).toEqual([]);
    expect(await latestVersion('npm', '@scope/pkg', fetch)).toBe('2.0.0');
    expect(await latestVersion('pip', 'requests', fetch)).toBe('2.32.3');
  });

  it('compares versions', () => {
    expect(isNewer('1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('1.9.3', '1.10.0')).toBe(false);
    expect(isNewer('2.0.0', '2.0.0-beta.1')).toBe(true);
    expect(isNewer('2.0.0', '2.0.0')).toBe(false);
    expect(isNewer('2.0', '2.0.0')).toBe(false);
  });

  it('builds the commands', () => {
    expect(commandArgs('npm', { kind: 'update', name: 'lodash' })).toEqual(['install', 'lodash@latest']);
    expect(commandArgs('npm', { kind: 'remove', name: 'lodash' })).toEqual(['uninstall', 'lodash']);
    expect(commandArgs('pip', { kind: 'install', name: 'six', version: '1.16.0' })).toEqual(['install', 'six==1.16.0']);
    expect(commandLine('npm', { kind: 'install', name: '@types/node' })).toBe('npm install @types/node');
  });
});
