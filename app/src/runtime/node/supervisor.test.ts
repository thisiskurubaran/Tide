/**
 * @jest-environment node
 */
/// <reference types="node" />
// Runs the real supervisor with real worker threads on the host Node.
import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createSupervisor } = require('../../../nodejs-assets/nodejs-project/supervisor');

type Msg = { type: string; id?: string; data?: string; code?: number; signal?: string };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-supervisor-'));
  const messages: Msg[] = [];
  const supervisor = createSupervisor({ send: (m: Msg) => messages.push(m) });
  supervisor.handle({ type: 'init', root });
  const file = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  const output = (id: string, type = 'stdout') =>
    messages.filter((m) => m.id === id && m.type === type).map((m) => m.data).join('');
  const exited = (id: string, timeout = 5000) =>
    new Promise<Msg>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const exit = messages.find((m) => m.id === id && m.type === 'exit');
        if (exit) return resolve(exit);
        if (Date.now() - start > timeout) return reject(new Error(`run ${id} did not exit`));
        setTimeout(check, 10);
      };
      check();
    });
  const waitFor = (pred: () => boolean, timeout = 5000) =>
    new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (pred()) return resolve();
        if (Date.now() - start > timeout) return reject(new Error('timed out'));
        setTimeout(check, 10);
      };
      check();
    });
  const run = (id: string, entry: string, args: string[] = [], extra = {}) =>
    supervisor.handle({ type: 'run', id, runtime: 'node', entry: `proj/${entry}`, cwd: 'proj', args, ...extra });
  return { root, supervisor, messages, file, output, exited, waitFor, run };
}

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

describe('supervisor', () => {
  it('runs a script with args, cwd and stdout', async () => {
    const t = setup();
    t.file('proj/index.js', 'console.log(process.argv.slice(2).join(","), require("path").basename(process.cwd()))');
    t.run('r1', 'index.js', ['a', 'b']);
    expect(await t.exited('r1')).toEqual({ type: 'exit', id: 'r1', code: 0 });
    expect(t.output('r1')).toBe('a,b proj\n');
  });

  it('reports stderr, uncaught errors and exit codes', async () => {
    const t = setup();
    t.file('proj/fail.js', 'console.error("warn"); throw new Error("boom")');
    t.file('proj/exit.js', 'process.exit(3)');
    t.run('r1', 'fail.js');
    t.run('r2', 'exit.js');
    expect((await t.exited('r1')).code).toBe(1);
    expect(t.output('r1', 'stderr')).toContain('warn');
    expect(t.output('r1', 'stderr')).toMatch(/Error: boom\n\s+at .*fail\.js:1/);
    expect((await t.exited('r2')).code).toBe(3);
  });

  it('feeds stdin to readline', async () => {
    const t = setup();
    t.file(
      'proj/ask.js',
      `const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
       rl.question('Name? ', (n) => { console.log('Hi ' + n); rl.close(); });`,
    );
    t.run('r1', 'ask.js');
    await t.waitFor(() => t.output('r1').includes('Name? '));
    t.supervisor.handle({ type: 'stdin', id: 'r1', data: 'Ada\n' });
    expect((await t.exited('r1')).code).toBe(0);
    expect(t.output('r1')).toContain('Hi Ada');
  });

  it('kills an infinite loop and can run again', async () => {
    const t = setup();
    t.file('proj/loop.js', 'console.log("start"); for (;;) {}');
    t.file('proj/ok.js', 'console.log("again")');
    t.run('r1', 'loop.js');
    await t.waitFor(() => t.output('r1').includes('start'));
    t.supervisor.handle({ type: 'kill', id: 'r1' });
    expect(await t.exited('r1')).toEqual({ type: 'exit', id: 'r1', code: 130, signal: 'SIGINT' });
    t.run('r2', 'ok.js');
    expect((await t.exited('r2')).code).toBe(0);
    expect(t.output('r2')).toBe('again\n');
    expect(t.supervisor.activeRuns()).toBe(0);
  });

  it('stops a run at its time limit', async () => {
    const t = setup();
    t.file('proj/slow.js', 'setInterval(() => {}, 1000)');
    t.run('r1', 'slow.js', [], { limits: { timeoutMs: 200 } });
    expect((await t.exited('r1')).signal).toBe('SIGINT');
    expect(t.output('r1', 'stderr')).toContain('time limit');
  });

  it('requires local files and node_modules', async () => {
    const t = setup();
    t.file('proj/node_modules/greet/package.json', '{"name":"greet","main":"lib.js"}');
    t.file('proj/node_modules/greet/lib.js', 'module.exports = (n) => "hello " + n');
    t.file('proj/util.js', 'module.exports = { name: "tide" }');
    t.file('proj/index.js', 'console.log(require("greet")(require("./util").name))');
    t.run('r1', 'index.js');
    await t.exited('r1');
    expect(t.output('r1')).toBe('hello tide\n');
  });

  it('refuses paths outside the workspace and unknown built-ins', async () => {
    const t = setup();
    t.supervisor.handle({ type: 'run', id: 'r1', runtime: 'node', entry: '../etc/passwd', cwd: 'proj', args: [] });
    t.supervisor.handle({ type: 'run', id: 'r2', runtime: 'node', entry: 'tide:nope', cwd: '.', args: [] });
    expect((await t.exited('r1')).code).toBe(1);
    expect(t.output('r1', 'stderr')).toContain('outside the workspace');
    expect(t.output('r2', 'stderr')).toContain('unknown built-in');
  });

  it('answers ping', () => {
    const t = setup();
    t.supervisor.handle({ type: 'ping' });
    expect(t.messages).toContainEqual(expect.objectContaining({ type: 'pong', node: process.version }));
  });
});
