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

  it('gives each overlapping run its own cwd without touching the process cwd', async () => {
    const t = setup();
    // a waits until b has started, then resolves relative paths in its own folder.
    t.file('a/run.js', [
      'const fs = require("fs"), path = require("path");',
      'process.stdin.once("data", async () => {',
      '  fs.writeFileSync("out.txt", "a");',
      '  await fs.promises.mkdir("sub/deep", { recursive: true });',
      '  fs.writeFileSync(path.join("sub", "x.txt"), "x");',
      '  process.chdir("sub");',
      '  console.log(path.basename(process.cwd()), fs.readFileSync("x.txt", "utf8"), fs.existsSync("deep"));',
      '  process.exit(0);',
      '});',
    ].join('\n'));
    t.file('b/run.js', 'require("fs").writeFileSync("out.txt", "b"); console.log(require("path").basename(process.cwd()))');
    const before = process.cwd();
    t.supervisor.handle({ type: 'run', id: 'a', runtime: 'node', entry: 'a/run.js', cwd: 'a', args: [] });
    t.supervisor.handle({ type: 'run', id: 'b', runtime: 'node', entry: 'b/run.js', cwd: 'b', args: [] });
    // A service-style run in the root starting alongside them.
    t.file('svc.js', 'console.log(process.cwd() === process.env.PWD)');
    t.supervisor.handle({ type: 'run', id: 's', runtime: 'node', entry: 'svc.js', cwd: '.', args: [] });
    await t.exited('b');
    await t.exited('s');
    t.supervisor.handle({ type: 'stdin', id: 'a', data: 'go\n' });
    await t.exited('a');
    expect(t.output('a')).toBe('sub x true\n');
    expect(t.output('b')).toBe('b\n');
    expect(t.output('s')).toBe('true\n');
    expect(fs.readFileSync(path.join(t.root, 'a/out.txt'), 'utf8')).toBe('a');
    expect(fs.readFileSync(path.join(t.root, 'b/out.txt'), 'utf8')).toBe('b');
    expect(fs.existsSync(path.join(t.root, 'out.txt'))).toBe(false);
    expect(process.cwd()).toBe(before);
  });

  it('starts child processes in the run folder, and resolves Buffer paths there', async () => {
    const t = setup();
    t.file('proj/sub/marker.txt', 'm');
    // Each child prints the folder it started in.
    const pwd = `${JSON.stringify(process.execPath)} -e "console.log(require('path').basename(process.cwd()))"`;
    t.file('proj/kid.js', 'console.log(require("path").basename(process.cwd()))');
    t.file('proj/cp.js', [
      'const cp = require("child_process"), fs = require("fs");',
      `const pwd = ${JSON.stringify(pwd)};`,
      'const node = process.execPath, code = "console.log(require(\'path\').basename(process.cwd()))";',
      'process.chdir("sub");',
      'const out = [];',
      'out.push(cp.execSync(pwd, { encoding: "utf8" }).trim());',
      'out.push(cp.execFileSync(node, ["-e", code], { encoding: "utf8" }).trim());',
      'out.push(cp.spawnSync(node, ["-e", code], { encoding: "utf8" }).stdout.trim());',
      'out.push(cp.execSync(pwd, { encoding: "utf8", cwd: ".." }).trim());',
      'out.push(fs.readFileSync(Buffer.from("marker.txt"), "utf8"));',
      'cp.exec(pwd, (e, a) => {',
      '  out.push(a.trim());',
      '  cp.execFile(node, ["-e", code], (e2, b) => {',
      '    out.push(b.trim());',
      '    let c = "";',
      '    const kid = cp.spawn(node, ["-e", code]);',
      '    kid.stdout.on("data", (d) => (c += d));',
      '    kid.on("close", () => {',
      '      out.push(c.trim());',
      '      const f = cp.fork("../kid.js", [], { silent: true });',
      '      let d = "";',
      '      f.stdout.on("data", (x) => (d += x));',
      '      f.on("close", async () => {',
      '        out.push(d.trim());',
      '        out.push((await require("util").promisify(cp.exec)(pwd)).stdout.trim());',
      '        console.log(out.join(","));',
      '      });',
      '    });',
      '  });',
      '});',
    ].join('\n'));
    t.run('r1', 'cp.js');
    expect(await t.exited('r1', 15000)).toEqual({ type: 'exit', id: 'r1', code: 0 });
    expect(t.output('r1', 'stderr')).toBe('');
    expect(t.output('r1')).toBe('sub,sub,sub,proj,m,sub,sub,sub,sub,sub\n');
  });

  it('fails a run whose cwd is missing', async () => {
    const t = setup();
    t.file('proj/index.js', '');
    t.supervisor.handle({ type: 'run', id: 'r1', runtime: 'node', entry: 'proj/index.js', cwd: 'nope', args: [] });
    expect((await t.exited('r1')).code).toBe(1);
    expect(t.output('r1', 'stderr')).toContain("can't enter nope");
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

  it('shows stack paths from the project root', async () => {
    const t = setup();
    t.file('projects/demo/src/app.js', 'function f() { throw new Error("nope") }\nf()');
    t.supervisor.handle({ type: 'run', id: 'r1', runtime: 'node', entry: 'projects/demo/src/app.js', cwd: 'projects/demo', args: [] });
    await t.exited('r1');
    const err = t.output('r1', 'stderr');
    expect(err).toContain('/src/app.js:1');
    expect(err).not.toContain(t.root);
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
