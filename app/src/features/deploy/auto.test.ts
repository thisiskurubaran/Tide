import { createMemoryFs } from '../files/memoryFs';
import { createFsStorage } from '../../state/storage';
import { createAutoDeployer, createDeployStore, SAVE_QUIET_MS } from './auto';
import type { DeployConfig } from './providers';

function setup(auto: 'off' | 'save' | 'commit', deploy = jest.fn(async () => ({ url: 'https://site.example' }))) {
  const store = createDeployStore(createFsStorage(createMemoryFs()));
  const timers: { fn: () => void; ms: number }[] = [];
  let t = 1000;
  const deployer = createAutoDeployer({
    store,
    readConfig: async () => ({ provider: 'netlify', folder: 'dist', auto }) as DeployConfig & { auto: typeof auto },
    deploy,
    now: () => t++,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => timers.shift(),
  });
  return { store, deployer, deploy, timers };
}

describe('automatic deploys', () => {
  it('deploys once saving has been quiet, not on every save', async () => {
    const { deployer, deploy, timers, store } = setup('save');
    await deployer.onSave('site');
    await deployer.onSave('site');
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(SAVE_QUIET_MS);
    timers[0].fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(store.getState().status.site).toEqual({ state: 'done', message: 'Deployed', url: 'https://site.example' });
    expect(store.getState().history.site[0]).toMatchObject({ provider: 'netlify', trigger: 'save', ok: true });
  });

  it('deploys after commits only when set to, and records failures', async () => {
    const failing = jest.fn(async () => {
      throw new Error('Netlify: Unauthorized (401)');
    });
    const off = setup('save', failing);
    await off.deployer.onCommit('site');
    expect(failing).not.toHaveBeenCalled();
    const on = setup('commit', failing);
    await on.deployer.onCommit('site');
    expect(on.store.getState().status.site).toEqual({ state: 'failed', message: 'Netlify: Unauthorized (401)' });
    expect(on.store.getState().history.site[0]).toMatchObject({ ok: false, trigger: 'commit', error: 'Netlify: Unauthorized (401)' });
  });

  it('runs one deploy at a time and one more for triggers that came in meanwhile', async () => {
    let release: () => void = () => undefined;
    const slow = jest.fn(() => new Promise<{ url: string }>((r) => (release = () => r({ url: 'u' }))));
    const { deployer } = setup('commit', slow);
    const first = deployer.run('site', 'manual');
    deployer.run('site', 'commit');
    deployer.run('site', 'commit');
    await new Promise((r) => setTimeout(r, 0));
    expect(slow).toHaveBeenCalledTimes(1);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(slow).toHaveBeenCalledTimes(2);
    release();
    await first;
  });
});
