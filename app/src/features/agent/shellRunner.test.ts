import type { RunnerMessage, RunRequest } from '@shared/protocol';

import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import type { Runner } from '../../runtime/runner';
import { createBuffersStore } from '../../state/buffers';
import { createProjectsStore } from '../../state/projects';
import { createFsStorage } from '../../state/storage';
import { createTabsStore } from '../../state/tabs';
import { Shell } from '../terminal/shell/shell';
import { createShellFs } from '../terminal/shell/shellFs';
import { createShellCommandRunner } from './shellRunner';

const tick = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => setImmediate(() => r()));
};

class FakeRunner implements Runner {
  requests: RunRequest[] = [];
  sent: unknown[] = [];
  listener: ((m: RunnerMessage) => void) | null = null;
  run(req: RunRequest, onMessage: (m: RunnerMessage) => void) {
    this.requests.push(req);
    this.listener = onMessage;
  }
  send(msg: unknown) {
    this.sent.push(msg);
  }
}

async function setup() {
  const memfs = createMemoryFs();
  const workspace = createWorkspace(memfs);
  await workspace.createProject('demo', 'node-hello');
  const buffers = createBuffersStore(workspace);
  const projects = createProjectsStore(workspace, createTabsStore(createFsStorage(memfs)), buffers);
  const runner = new FakeRunner();
  const commands = createShellCommandRunner(
    (hooks) =>
      new Shell({
        project: 'demo',
        fs: createShellFs('demo', workspace, projects, buffers),
        runner,
        write: hooks.write,
        projectRoot: 'projects/demo',
        newId: () => 'r1',
        onBusy: hooks.onBusy,
        onRunExit: hooks.onRunExit,
      }),
  );
  return { commands, runner, workspace };
}

describe('hidden shell commands', () => {
  it('captures a built-in command without the echo or prompt', async () => {
    const { commands } = await setup();
    const result = await commands.run('echo hello agent', { timeoutMs: 5000 });
    expect(result).toEqual({ output: 'hello agent\n', code: null, timedOut: false });
  });

  it('waits for a program and returns its output and exit code', async () => {
    const { commands, runner } = await setup();
    const pending = commands.run('node index.js', { timeoutMs: 5000 });
    await tick();
    expect(runner.requests[0].entry).toBe('projects/demo/index.js');
    runner.listener?.({ type: 'stdout', id: 'r1', data: 'Hi\n' });
    runner.listener?.({ type: 'stderr', id: 'r1', data: 'boom\n' });
    runner.listener?.({ type: 'exit', id: 'r1', code: 2 });
    const result = await pending;
    expect(result.code).toBe(2);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('Hi\nboom\n');
  });

  it('reports a missing command as 127', async () => {
    const { commands } = await setup();
    const result = await commands.run('make all', { timeoutMs: 5000 });
    expect(result.code).toBe(127);
    expect(result.output).toMatch(/make: command not found/);
  });

  it('kills a program that runs past the timeout', async () => {
    const { commands, runner } = await setup();
    const result = await commands.run('node index.js', { timeoutMs: 20 });
    expect(result.timedOut).toBe(true);
    expect(runner.sent).toContainEqual({ type: 'kill', id: 'r1' });
  });

  it('stops on abort', async () => {
    const { commands, runner } = await setup();
    const controller = new AbortController();
    const pending = commands.run('node index.js', { timeoutMs: 5000, signal: controller.signal });
    await tick();
    controller.abort();
    const result = await pending;
    expect(result.output).toContain('[stopped]');
    expect(runner.sent).toContainEqual({ type: 'kill', id: 'r1' });
  });
});
