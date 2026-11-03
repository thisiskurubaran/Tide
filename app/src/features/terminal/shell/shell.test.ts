import type { RunnerMessage, RunRequest } from '@shared/protocol';

import { createMemoryFs } from '../../files/memoryFs';
import { createWorkspace } from '../../files/workspace';
import type { Runner } from '../../../runtime/runner';
import { createBuffersStore } from '../../../state/buffers';
import { createProjectsStore } from '../../../state/projects';
import { createFsStorage } from '../../../state/storage';
import { createTabsStore } from '../../../state/tabs';
import { Shell } from './shell';
import { createShellFs } from './shellFs';
import { tokenize } from './tokenize';
import { resolvePath } from './paths';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
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

async function setup(projectEnv?: { values: Record<string, string>; secrets: string[] }) {
  const memfs = createMemoryFs();
  const workspace = createWorkspace(memfs);
  await workspace.createProject('demo', 'node-hello');
  const tabs = createTabsStore(createFsStorage(memfs));
  const buffers = createBuffersStore(workspace);
  const projects = createProjectsStore(workspace, tabs, buffers);
  const runner = new FakeRunner();
  let output = '';
  const shell = new Shell({
    project: 'demo',
    fs: createShellFs('demo', workspace, projects, buffers),
    runner,
    write: (d) => (output += d),
    projectRoot: 'projects/demo',
    newId: () => 'r1',
    toolEnv: () => ({ TIDE_GIT_NAME: 'Ada' }),
    ...(projectEnv ? { projectEnv: async () => projectEnv } : {}),
  });
  shell.start();
  await tick();
  const run = async (line: string) => {
    output = '';
    shell.input(`${line}\r`);
    await tick();
    return strip(output);
  };
  return { shell, run, memfs, workspace, runner, tabs, buffers, out: () => strip(output), clear: () => (output = '') };
}

describe('tokenize', () => {
  it('handles quotes, escapes and redirects', () => {
    expect(tokenize(`echo "a b" 'c d' e\\ f`).args).toEqual(['echo', 'a b', 'c d', 'e f']);
    expect(tokenize('echo hi > out.txt')).toEqual({ args: ['echo', 'hi'], redirect: { append: false, path: 'out.txt' } });
    expect(tokenize('echo hi>>log')).toEqual({ args: ['echo', 'hi'], redirect: { append: true, path: 'log' } });
    expect(tokenize('echo ">"').args).toEqual(['echo', '>']);
    expect(tokenize('echo ""').args).toEqual(['echo', '']);
    expect(() => tokenize('echo "open')).toThrow('unterminated');
    expect(() => tokenize('echo >')).toThrow('missing file name');
  });
});

describe('resolvePath', () => {
  it('resolves against cwd and stays in the project', () => {
    expect(resolvePath('src', 'a.js')).toBe('src/a.js');
    expect(resolvePath('src/lib', '../a.js')).toBe('src/a.js');
    expect(resolvePath('src', '/tide.json')).toBe('tide.json');
    expect(resolvePath('src', '~/x')).toBe('x');
    expect(resolvePath('src', '.')).toBe('src');
    expect(() => resolvePath('src', '../..')).toThrow('outside the project');
  });
});

describe('shell', () => {
  it('prints a prompt with the project and directory', async () => {
    const { out } = await setup();
    expect(out()).toContain('demo / $ ');
  });

  it('runs fs commands against the workspace', async () => {
    const { run, memfs } = await setup();
    expect(await run('ls')).toMatch(/index\.js\s+tide\.json/);
    await run('mkdir -p src/lib');
    await run('cd src');
    expect(await run('pwd')).toContain('/src');
    await run('echo hello world > lib/a.txt');
    await run('echo again >> lib/a.txt');
    expect(await run('cat lib/a.txt')).toContain('hello world\nagain\n');
    await run('touch b.js');
    expect(await run('ls')).toMatch(/lib\/\s+b\.js/);
    await run('cp -r lib copy');
    await run('mv b.js ../moved.js');
    await run('cd ..');
    expect(memfs.files.get('projects/demo/src/copy/a.txt')).toBe('hello world\nagain\n');
    expect(memfs.files.has('projects/demo/moved.js')).toBe(true);
    await run('rm -r src');
    expect(await run('ls')).not.toContain('src');
  });

  it('reports errors without stopping', async () => {
    const { run } = await setup();
    expect(await run('cat nope.js')).toContain('cat: nope.js: no such file or directory');
    expect(await run('rm src')).toContain('no such file');
    await run('mkdir src');
    expect(await run('rm src')).toContain('is a directory (use rm -r)');
    expect(await run('cd ../..')).toContain('outside the project');
    expect(await run('rm /')).toContain('refusing to remove the project root');
    expect(await run('mkdir a/b')).toContain('no such file or directory');
    expect(await run('ls')).toContain('demo / $ ');
  });

  it('keeps keys typed while a command is still running', async () => {
    const { shell, out, clear, memfs } = await setup();
    clear();
    // All at once, the way a paste or a fast hardware keyboard delivers it.
    shell.input('mkdir -p a/b\recho hi > a/b/x.txt\rcat a/b/x.txt\rcd a\rpwd\r');
    await tick();
    expect(memfs.files.get('projects/demo/a/b/x.txt')).toBe('hi\n');
    expect(out()).toContain('hi\n');
    expect(out()).toContain('/a\n');
    expect(out()).not.toContain('command not found');
  });

  it('points unknown commands at remote mode', async () => {
    const { run } = await setup();
    const out = await run('svn status');
    expect(out).toContain('svn: command not found');
    expect(out).toContain('switch the terminal to Remote');
  });

  it('keeps history and edits lines with arrow keys', async () => {
    const { shell, out, clear } = await setup();
    shell.input('echo one\r');
    await tick();
    shell.input('echo two\r');
    await tick();
    clear();
    shell.input('\x1b[A\x1b[A\r');
    await tick();
    expect(out()).toContain('one\n');
    clear();
    // Type "ecxho", move left three, delete the x, run.
    shell.input('ecxho hi');
    shell.input('\x1b[D\x1b[D\x1b[D\x1b[D\x1b[D\x7f\r');
    await tick();
    expect(out()).toContain('hi\n');
  });

  it('cancels a line with Ctrl-C', async () => {
    const { shell, out, clear } = await setup();
    clear();
    shell.input('rm -r everything\x03');
    await tick();
    expect(out()).toContain('^C');
    expect(out()).toContain('demo / $ ');
  });

  it('completes commands and paths with Tab', async () => {
    const { shell, run, out, clear } = await setup();
    await run('mkdir src');
    await run('touch src/server.js');
    clear();
    shell.input('ca\t');
    await tick();
    expect(out()).toContain('cat ');
    shell.input('\x15cat sr\t');
    await tick();
    shell.input('se\t');
    await tick();
    expect(out()).toContain('cat src/server.js ');
  });

  it('changes into folders with spaces, quoted, escaped or not', async () => {
    const { run } = await setup();
    await run('mkdir "Operating System Portfolio"');
    await run('cd Operating System Portfolio/');
    expect(await run('pwd')).toContain('/Operating System Portfolio');
    await run('cd ..');
    await run('cd "Operating System Portfolio"');
    expect(await run('pwd')).toContain('/Operating System Portfolio');
    await run('cd ..');
    await run('cd Operating\\ System\\ Portfolio');
    expect(await run('pwd')).toContain('/Operating System Portfolio');
    await run('cd ..');
    expect(await run('cd no such folder')).toContain('put names with spaces in quotes: cd "no such folder"');
  });

  it('escapes spaces when completing names with Tab', async () => {
    const { shell, run, out, clear } = await setup();
    await run('mkdir "My App"');
    await run('touch "My App/main file.js"');
    clear();
    shell.input('cd My\t');
    await tick();
    expect(out()).toContain('cd My\\ App/');
    shell.input('\x15cat My\\ App/ma\t');
    await tick();
    expect(out()).toContain('cat My\\ App/main\\ file.js ');
    shell.input('\x15cat "My App/ma\t');
    await tick();
    expect(out()).toContain('cat "My App/main file.js" ');
    shell.input('\x15cd My\t');
    await tick();
    shell.input('\r');
    await tick();
    clear();
    expect(await run('pwd')).toContain('/My App');
  });

  it('runs programs through the runner and forwards stdin and Ctrl-C', async () => {
    const { shell, run, runner, out, clear } = await setup();
    await run('node index.js world');
    expect(runner.requests[0]).toEqual({
      type: 'run',
      id: 'r1',
      runtime: 'node',
      entry: 'projects/demo/index.js',
      cwd: 'projects/demo',
      args: ['world'],
    });
    clear();
    runner.listener?.({ type: 'stdout', id: 'r1', data: 'Name? ' });
    shell.input('Ada\r');
    await tick();
    expect(runner.sent).toContainEqual({ type: 'stdin', id: 'r1', data: 'Ada\n' });
    shell.input('\x03');
    expect(runner.sent).toContainEqual({ type: 'kill', id: 'r1' });
    runner.listener?.({ type: 'exit', id: 'r1', code: 130, signal: 'SIGINT' });
    await tick();
    expect(out()).toContain('Name? Ada');
    expect(out()).toContain('[exited with signal SIGINT]');
    expect(out().trimEnd().endsWith('demo / $')).toBe(true);
  });

  it('runs npm through the built-in installer', async () => {
    const { run, runner } = await setup();
    await run('npm install express');
    expect(runner.requests[0]).toMatchObject({ runtime: 'node', entry: 'tide:npm', cwd: 'projects/demo', args: ['install', 'express'] });
  });

  it('runs git through the built-in client with the tool environment', async () => {
    const { run, runner } = await setup();
    await run('git commit -m "first try"');
    expect(runner.requests[0]).toMatchObject({
      entry: 'tide:git',
      args: ['commit', '-m', 'first try'],
      env: { TIDE_GIT_NAME: 'Ada' },
    });
  });

  it("gives programs the project's variables, and env shows them with secrets hidden", async () => {
    const { run, runner } = await setup({ values: { PORT: '4000', API_KEY: 'sk-live', TIDE_GIT_NAME: 'Grace' }, secrets: ['API_KEY'] });
    await run('node index.js');
    expect(runner.requests[0].env).toEqual({ PORT: '4000', API_KEY: 'sk-live', TIDE_GIT_NAME: 'Grace' });
    runner.listener?.({ type: 'exit', id: 'r1', code: 0 });
    await run('git status');
    // The tool's own settings win over a same-named project variable.
    expect(runner.requests[1].env).toMatchObject({ PORT: '4000', TIDE_GIT_NAME: 'Ada' });
    runner.listener?.({ type: 'exit', id: 'r1', code: 0 });
    const out = await run('env');
    expect(out).toContain('PORT=4000');
    expect(out).toContain('API_KEY=•••••• (Keychain)');
    expect(out).not.toContain('sk-live');
    expect(await run('printenv PORT')).toContain('4000');
    expect(await run('printenv NOPE')).toContain("NOPE isn't set");
  });

  it('sends no environment when the project has none', async () => {
    const { run, runner } = await setup();
    await run('node index.js');
    expect(runner.requests[0].env).toBeUndefined();
    runner.listener?.({ type: 'exit', id: 'r1', code: 0 });
    expect(await run('env')).toContain('No variables yet');
  });

  it('kills the running program when disposed', async () => {
    const { shell, run, runner } = await setup();
    await run('node index.js');
    shell.dispose();
    expect(runner.sent).toContainEqual({ type: 'kill', id: 'r1' });
  });

  it('runs pip and python -m pip through the built-in installer', async () => {
    const { run, runner } = await setup();
    await run('pip install requests');
    runner.listener?.({ type: 'exit', id: 'r1', code: 0 });
    await run('python -m pip list');
    expect(runner.requests.map((r) => [r.entry, r.args])).toEqual([
      ['tide:pip', ['install', 'requests']],
      ['tide:pip', ['list']],
    ]);
  });

  it('run uses tide.json', async () => {
    const { run, runner } = await setup();
    await run('cd /');
    await run('run');
    expect(runner.requests[0]).toMatchObject({ runtime: 'node', entry: 'projects/demo/index.js', cwd: 'projects/demo' });
  });

  it('run takes a configuration name from tide.json', async () => {
    const { run, runner, workspace } = await setup();
    await workspace.writeFile(
      'demo',
      'tide.json',
      JSON.stringify({ runtime: 'node', entry: 'index.js', configurations: [{ name: 'Server', entry: 'index.js', args: ['--port', '3000'] }] }),
    );
    await run('run server');
    expect(runner.requests[0]).toMatchObject({ entry: 'projects/demo/index.js', args: ['--port', '3000'] });
    runner.listener?.({ type: 'exit', id: 'r1', code: 0 });
    expect(await run('run nope')).toContain('no configuration named "nope"; tide.json has Default, Server');
  });

  it('runs TypeScript with node, run, tsx and ts-node, noting once that types are not checked', async () => {
    const { run, runner, workspace, memfs } = await setup();
    await memfs.writeFile('projects/demo/index.ts', 'const n: number = 1;\n');
    const exit = () => runner.listener?.({ type: 'exit', id: 'r1', code: 0 });
    const first = await run('node index.ts world');
    expect(runner.requests[0]).toEqual({ type: 'run', id: 'r1', runtime: 'node', entry: 'projects/demo/index.ts', cwd: 'projects/demo', args: ['world'] });
    expect(first).toContain('tide: running TypeScript without type-checking');
    exit();
    await tick();

    expect(await run('npx tsx index.ts a')).not.toContain('type-checking');
    exit();
    await run('npx ts-node --transpile-only -P tsconfig.json index.ts b');
    exit();
    await run('tsx -- index.ts c');
    exit();
    await workspace.writeFile('demo', 'tide.json', JSON.stringify({ runtime: 'node', entry: 'index.ts' }));
    await run('run');
    exit();
    expect(runner.requests.slice(1).map((r) => [r.runtime, r.entry, r.args])).toEqual([
      ['node', 'projects/demo/index.ts', ['a']],
      ['node', 'projects/demo/index.ts', ['b']],
      ['node', 'projects/demo/index.ts', ['c']],
      ['node', 'projects/demo/index.ts', []],
    ]);
    expect(await run('tsx watch index.ts')).toContain('watch mode needs the Remote terminal');
    expect(await run('npx tsx')).toContain('usage: tsx <file>');
  });

  it('runs package.json scripts that use tsx', async () => {
    const { run, runner, memfs } = await setup();
    await memfs.writeFile('projects/demo/src/main.ts', '');
    await memfs.writeFile('projects/demo/package.json', JSON.stringify({ scripts: { start: 'tsx src/main.ts --port 1', dev: 'npx ts-node src/main.ts' } }));
    await run('npm start');
    expect(runner.requests[0]).toMatchObject({ runtime: 'node', entry: 'projects/demo/src/main.ts', args: ['--port', '1'] });
    runner.listener?.({ type: 'exit', id: 'r1', code: 0 });
    await tick();
    await run('npm run dev');
    expect(runner.requests[1]).toMatchObject({ runtime: 'node', entry: 'projects/demo/src/main.ts', args: [] });
  });

  it('shell writes replace an open editor buffer', async () => {
    const { run, buffers } = await setup();
    await buffers.getState().load('demo', 'index.js');
    buffers.getState().edit('demo', 'index.js', 'unsaved');
    await run('echo overwritten > index.js');
    expect(buffers.getState().buffers['demo\u0000index.js']).toEqual({ content: 'overwritten\n', saved: 'overwritten\n' });
  });
});

describe('npm run in the Local terminal', () => {
  const exit = (runner: FakeRunner, code: number) => runner.listener?.({ type: 'exit', id: 'r1', code });
  async function withPackage() {
    const t = await setup();
    await t.memfs.writeFile('projects/demo/package.json', JSON.stringify({
      scripts: { pretest: 'node lint.js', test: 'NODE_ENV=test node index.js && echo done', build: 'tsc -p .', bad: 'cat x | grep y', start: 'node index.js' },
    }));
    await t.memfs.writeFile('projects/demo/lint.js', '');
    await t.memfs.writeFile('projects/demo/node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', bin: { tsc: './bin/tsc' } }));
    return t;
  }

  it('lists scripts and runs pre-scripts, env prefixes and && chains in order', async () => {
    const t = await withPackage();
    expect(await t.run('npm run')).toContain('NODE_ENV=test node index.js && echo done');
    await t.run('npm test');
    expect(t.runner.requests.map((r) => r.entry)).toEqual(['projects/demo/lint.js']);
    exit(t.runner, 0);
    await tick();
    expect(t.runner.requests[1]).toMatchObject({ entry: 'projects/demo/index.js', env: expect.objectContaining({ NODE_ENV: 'test' }) });
    exit(t.runner, 0);
    await tick();
    expect(t.out()).toContain('done');
    expect(t.out()).toContain('> test');
  });

  it('stops at a failing step, and runs node_modules binaries with node', async () => {
    const t = await withPackage();
    await t.run('npm test');
    exit(t.runner, 2);
    await tick();
    expect(t.runner.requests).toHaveLength(1);
    expect(t.out()).toContain('npm run pretest failed with exit code 2');

    await t.run('npm run build -- --noEmit');
    expect(t.runner.requests[1]).toMatchObject({ runtime: 'node', entry: 'projects/demo/node_modules/typescript/bin/tsc', args: ['-p', '.', '--noEmit'] });
    exit(t.runner, 0);
    await tick();
    await t.run('npx tsc --version');
    expect(t.runner.requests[2]).toMatchObject({ entry: 'projects/demo/node_modules/typescript/bin/tsc', args: ['--version'] });
  });

  it('explains scripts it can’t run locally, and missing ones', async () => {
    const t = await withPackage();
    expect(await t.run('npm run bad')).toContain('needs a full shell');
    expect(await t.run('npm run nope')).toContain('missing script: "nope"');
    await t.memfs.writeFile('projects/demo/package.json', JSON.stringify({ scripts: { lint: 'eslint .' } }));
    expect(await t.run('npm run lint')).toContain('eslint: not available in Local mode');
  });

  it('still sends npm install to the built-in npm', async () => {
    const t = await withPackage();
    await t.run('npm install left-pad');
    expect(t.runner.requests[0]).toMatchObject({ entry: 'tide:npm', args: ['install', 'left-pad'] });
  });
});

describe('busy reporting', () => {
  it('reports busy while a program runs and idle back at the prompt', async () => {
    const memfs = createMemoryFs();
    const workspace = createWorkspace(memfs);
    await workspace.createProject('demo', 'node-hello');
    const tabs = createTabsStore(createFsStorage(memfs));
    const buffers = createBuffersStore(workspace);
    const projects = createProjectsStore(workspace, tabs, buffers);
    const runner = new FakeRunner();
    const busy: boolean[] = [];
    const shell = new Shell({
      project: 'demo',
      fs: createShellFs('demo', workspace, projects, buffers),
      runner,
      write: () => undefined,
      projectRoot: 'projects/demo',
      newId: () => 'r1',
      onBusy: (b) => busy.push(b),
    });
    shell.start();
    shell.input('node index.js\r');
    await tick();
    expect(busy).toEqual([true]);
    runner.listener!({ type: 'exit', id: 'r1', code: 0 } as RunnerMessage);
    await tick();
    expect(busy).toEqual([true, false]);
  });
});
