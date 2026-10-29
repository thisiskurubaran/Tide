import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import type { Runner } from '../../runtime/runner';
import { loadComparison } from './sources';

// A runner that answers `git __tide show` like the built-in git does.
function gitRunner(stdout: string, code = 0, stderr = ''): Runner {
  return {
    run: (_req, onMessage) => {
      setTimeout(() => {
        if (stdout) onMessage({ type: 'stdout', id: 'x', data: stdout } as never);
        if (stderr) onMessage({ type: 'stderr', id: 'x', data: stderr } as never);
        onMessage({ type: 'exit', id: 'x', code } as never);
      }, 0);
      return { send: () => undefined, kill: () => undefined } as never;
    },
  } as unknown as Runner;
}

async function setup() {
  const workspace = createWorkspace(createMemoryFs());
  await workspace.createEmptyProject('p');
  await workspace.createFile('p', '', 'a.js', 'saved\n');
  await workspace.createFile('p', '', 'b.js', 'other\n');
  return workspace;
}

describe('loadComparison', () => {
  it('compares unsaved edits with the saved file, and with another file', async () => {
    const workspace = await setup();
    const sources = { workspace, runner: gitRunner(''), current: async () => 'edited\n' };
    expect(await loadComparison('p', { path: 'a.js', with: 'saved' }, sources)).toMatchObject({ original: 'saved\n', modified: 'edited\n', saveExplicitly: false });
    expect(await loadComparison('p', { path: 'a.js', with: { file: 'b.js' } }, sources)).toMatchObject({
      title: 'a.js ↔ b.js',
      original: 'other\n',
      controls: { accept: 'Keep', reject: 'Use b.js' },
    });
  });

  it('compares with the last commit', async () => {
    const workspace = await setup();
    const runner = gitRunner(`${JSON.stringify({ binary: false, head: 'committed\n', index: null, work: null })}\n`);
    const c = await loadComparison('p', { path: 'a.js', with: 'head' }, { workspace, runner, current: async () => 'edited\n' });
    expect(c).toMatchObject({ original: 'committed\n', modified: 'edited\n' });
    await expect(
      loadComparison('p', { path: 'a.js', with: 'head' }, { workspace, runner: gitRunner('', 1, 'fatal: not a git repository'), current: async () => '' }),
    ).rejects.toThrow('not a Git repository');
  });

  it('turns conflict markers into a merge', async () => {
    const workspace = await setup();
    const text = 'a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\n';
    const c = await loadComparison('p', { path: 'a.js', with: 'merge' }, { workspace, runner: gitRunner(''), current: async () => text });
    expect(c).toEqual({
      title: 'a.js: 1 conflict',
      original: 'a\ntheirs\n',
      modified: 'a\nours\n',
      controls: { accept: 'Keep HEAD', reject: 'Use feature' },
      saveExplicitly: true,
    });
  });
});
