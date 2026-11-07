/**
 * @jest-environment node
 */
/// <reference types="node" />
import fs from 'fs';

import { ensureServiceBundles, stopRuns, supervisorRunner } from '../testing';
import { applyEdits, createTsClient, editsMatchOneName } from './client';

const cwd = process.cwd();
afterEach(() => {
  stopRuns();
  process.chdir(cwd);
});
beforeAll(ensureServiceBundles, 120_000);

function setup() {
  const runner = supervisorRunner();
  runner.file('projects/p/src/util.ts', '/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n');
  const main = "import { add } from './util';\nconst total = add(1, 2);\n";
  runner.file('projects/p/src/main.ts', main);
  return { runner, ts: createTsClient(runner), main };
}

describe('IntelliSense', () => {
  it('completes members, with unsaved text from the editor', async () => {
    const { ts, main } = setup();
    const text = `${main}total.toF`;
    const result = await ts.completions('p', 'src/main.ts', text, text.length);
    expect(result.from).toBe(text.length - 3);
    expect(result.items).toContainEqual({ label: 'toFixed', type: 'method' });
    expect(result.items.every((i) => i.label.toLowerCase().startsWith('t'))).toBe(true);
    ts.stop();
  }, 30_000);

  it('shows hover with documentation and finds the definition in another file', async () => {
    const { ts, main } = setup();
    const at = main.indexOf('add(1');
    await expect(ts.hover('p', 'src/main.ts', main, at)).resolves.toMatchObject({ text: expect.stringContaining('Adds two numbers.') });
    await expect(ts.definition('p', 'src/main.ts', main, at)).resolves.toEqual([
      { path: 'src/util.ts', line: 2, column: 17, preview: 'export function add(a: number, b: number): number {' },
    ]);
    ts.stop();
  }, 30_000);

  it('reports type errors with positions', async () => {
    const { ts } = setup();
    const text = 'const s: string = 5;\nexport {};\n';
    const [d] = await ts.diagnostics('p', 'src/bad.ts', text);
    expect(d).toMatchObject({ line: 1, column: 7, severity: 'error', message: expect.stringContaining('ts2322') });
    ts.stop();
  }, 60_000);

  it('renames a symbol across files', async () => {
    const { ts, main, runner } = setup();
    const files = await ts.rename('p', 'src/main.ts', main, main.indexOf('add(1'), 'sum');
    const read = (p: string) => fs.readFileSync(`${runner.root}/projects/p/${p}`, 'utf8');
    const result = Object.fromEntries(files.map((f) => [f.path, applyEdits(f.path === 'src/main.ts' ? main : read(f.path), f.edits)]));
    expect(result['src/main.ts']).toBe("import { sum } from './util';\nconst total = sum(1, 2);\n");
    expect(result['src/util.ts']).toContain('export function sum(a: number');
    ts.stop();
  }, 30_000);

  it('understands require in plain JavaScript', async () => {
    const { ts } = setup();
    const text = "const util = require('./src/util');\nutil.a";
    const result = await ts.completions('p', 'index.js', text, text.length);
    expect(result.items.map((i) => i.label)).toContain('add');
    ts.stop();
  }, 30_000);
});

describe('editsMatchOneName', () => {
  it('accepts edits that all replace the same name', () => {
    const a = 'from util import añadir\r\nañadir(1)\r\n';
    const b = 'def añadir():\r\n    pass\r\n';
    const at = (i: number) => ({ from: i, to: i + 'añadir'.length, insert: 'plus' });
    expect(editsMatchOneName([{ edits: [at(17), at(25)] }, { edits: [at(4)] }], [a, b])).toBe(true);
  });

  it('rejects offsets that are shifted, e.g. by line endings counted differently', () => {
    const text = 'x = 1\r\ndef add():\r\n    add()\r\n';
    const right = text.indexOf('add');
    expect(editsMatchOneName([{ edits: [{ from: right, to: right + 3, insert: 'p' }] }], [text])).toBe(true);
    // One char short per earlier line, as with \n-only offsets.
    expect(editsMatchOneName([{ edits: [{ from: right - 1, to: right + 2, insert: 'p' }] }], [text])).toBe(false);
    const second = text.lastIndexOf('add');
    const files = [{ edits: [{ from: right, to: right + 3, insert: 'p' }, { from: second - 2, to: second + 1, insert: 'p' }] }];
    expect(editsMatchOneName(files, [text])).toBe(false);
  });

  it("accepts any Python identifier, by Python's rules", () => {
    const one = (name: string) => editsMatchOneName([{ edits: [{ from: 4, to: 4 + name.length, insert: 'p' }] }], [`def ${name}(): pass`]);
    // Other_ID_Start (℘, ℮) and Other_ID_Continue (U+00B7, U+0387, U+1369, U+19DA), as Python allows them.
    for (const name of ['℘', '℮x', 'a·b', 'a\u0387', 'n\u1369', 'n\u19da', '_x1', 'añadir', 'ｆｕｌｌ', '変数', 'ﬁ', '𝔘']) expect(one(name)).toBe(true);
    // Not identifiers: Python rejects these too.
    for (const name of ['·a', '1a', 'a-b', 'a b', '゛', 'a゜', '']) expect(one(name)).toBe(false);
  });
});
