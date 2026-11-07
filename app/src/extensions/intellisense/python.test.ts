/**
 * @jest-environment node
 */
/// <reference types="node" />
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { Snippet } from '../pythonTools';
import { applyEdits } from './client';
import { createPyClient, TIMEOUTS } from './python';

type Params = { op: string; id: string; method?: string; args?: Record<string, unknown> };
const parse = (code: string) => (JSON.parse(code.slice(code.indexOf('\n') + 1)) as { params: Params }).params;
const reply = (result: unknown) => JSON.stringify({ result });

describe('Python IntelliSense client', () => {
  it('cancels a completion when a newer one starts', async () => {
    const seen: Params[] = [];
    const snippet: Snippet = async (code) => {
      const p = parse(code);
      seen.push(p);
      if (p.op === 'cancel') return reply(null);
      // The first request never finishes; the second does at once.
      return reply(p.id.endsWith('-1') ? { done: false } : { done: true, value: { from: 0, items: [{ label: 'print' }] } });
    };
    const py = createPyClient(snippet, () => '/docs');
    const first = py.completions('p', 'main.py', 'pr', 2);
    const second = py.completions('p', 'main.py', 'pri', 3);
    await expect(second).resolves.toEqual({ from: 0, items: [{ label: 'print' }] });
    await expect(first).resolves.toBeNull();
    expect(seen.find((p) => p.op === 'cancel')?.id).toMatch(/-1$/);
    expect(seen[0].args).toEqual({ root: '/docs', project: 'p', path: 'main.py', content: 'pr', offset: 2 });
  });

  it('gives up after its timeout and cancels the job', async () => {
    const ops: string[] = [];
    const snippet: Snippet = async (code) => {
      ops.push(parse(code).op);
      await new Promise((r) => setTimeout(r, 5));
      return reply({ done: false });
    };
    const py = createPyClient(snippet, () => '/docs', { ...TIMEOUTS, hover: 50 });
    await expect(py.hover('p', 'main.py', 'x', 0)).rejects.toThrow('took too long');
    expect(ops[0]).toBe('call');
    expect(ops).toContain('poll');
    expect(ops[ops.length - 1]).toBe('cancel');
  });

  it('shows errors without the Python exception names', async () => {
    const py = createPyClient(async () => JSON.stringify({ error: 'RuntimeError: ValueError: x y is not a valid Python name' }), () => '/docs');
    await expect(py.rename('p', 'main.py', 'a = 1', 0, 'x y')).rejects.toThrow(/^x y is not a valid Python name$/);
  });
});

// End to end with the host's python3 and the jedi and parso that npm install fetched.
const pythonDir = path.join(__dirname, '../../../modules/python-runtime/python');
const hasJedi =
  fs.existsSync(path.join(pythonDir, 'jedi')) && spawnSync('python3', ['-c', 'import sys; assert sys.version_info >= (3, 10)']).status === 0;

// tide_runner.snippet in a long-lived python3, one JSON line per call, like the app's runtime.
function hostSnippet(): { snippet: Snippet; stop(): void } {
  const bridge = 'import json, sys, tide_runner\nfor line in sys.stdin:\n    print(json.dumps(tide_runner.snippet(json.loads(line))), flush=True)\n';
  const proc: ChildProcessWithoutNullStreams = spawn('python3', ['-I', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(pythonDir)})\n${bridge}`]);
  const waiting: ((out: string) => void)[] = [];
  let buffer = '';
  proc.stdout.on('data', (d: Buffer) => {
    buffer += d.toString();
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      waiting.shift()?.(JSON.parse(buffer.slice(0, nl)) as string);
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  });
  return {
    snippet: (code) =>
      new Promise((resolve) => {
        waiting.push(resolve);
        proc.stdin.write(`${JSON.stringify(code)}\n`);
      }),
    stop: () => proc.kill(),
  };
}

(hasJedi ? describe : describe.skip)('Python IntelliSense with Jedi', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-jedi-'));
  const write = (rel: string, text: string) => {
    const file = path.join(root, 'projects/p', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('pkg/util.py', 'def add(a, b):\n    """Adds two numbers."""\n    return a + b\n');
  const main = 'from pkg.util import add\n\ntotal = add(1, 2)\n';
  write('main.py', main);
  const host = hostSnippet();
  const py = createPyClient(host.snippet, () => root, { ...TIMEOUTS, complete: 30_000, hover: 30_000 });
  afterAll(() => {
    host.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('completes, hovers and goes to definition across files', async () => {
    const text = `${main}import pkg.util\npkg.util.a`;
    const result = await py.completions('p', 'main.py', text, text.length);
    expect(result).toMatchObject({ from: text.length - 1 });
    expect(result?.items).toContainEqual({ label: 'add', type: 'function', detail: '(a, b)' });
    const at = main.indexOf('add(1');
    await expect(py.hover('p', 'main.py', main, at)).resolves.toEqual({ text: 'def add(a, b)\n\nAdds two numbers.', from: at, to: at + 3 });
    await expect(py.definition('p', 'main.py', main, at)).resolves.toEqual([
      { path: 'pkg/util.py', line: 1, column: 5, preview: 'def add(a, b):' },
    ]);
  }, 60_000);

  it('finds references and renames across the project', async () => {
    const at = main.indexOf('add(1');
    const refs = await py.references('p', 'main.py', main, at);
    expect(refs.map((r) => `${r.path}:${r.line}`)).toEqual(['main.py:1', 'main.py:3', 'pkg/util.py:1']);
    const files = await py.rename('p', 'main.py', main, at, 'plus');
    const read = (p: string) => fs.readFileSync(path.join(root, 'projects/p', p), 'utf8');
    const result = Object.fromEntries(files.map((f) => [f.path, applyEdits(f.path === 'main.py' ? main : read(f.path), f.edits)]));
    expect(result['main.py']).toBe('from pkg.util import plus\n\ntotal = plus(1, 2)\n');
    expect(result['pkg/util.py']).toContain('def plus(a, b):');
  }, 60_000);
});
