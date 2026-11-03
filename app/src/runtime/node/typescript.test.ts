/**
 * @jest-environment node
 */
/// <reference types="node" />
// Running .ts files in the Node supervisor: Sucrase strips the types, CommonJS
// projects compile through a require hook, ESM projects into .tide/build.
import fs from 'fs';
import os from 'os';
import path from 'path';

/* eslint-disable @typescript-eslint/no-require-imports */
const ts = require('../../../nodejs-assets/nodejs-project/typescript');
const { createSupervisor } = require('../../../nodejs-assets/nodejs-project/supervisor');
/* eslint-enable @typescript-eslint/no-require-imports */

type Msg = { type: string; id?: string; data?: string; code?: number };

function tmp() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tide-ts-')));
  const file = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
    return path.join(root, rel);
  };
  return { root, file };
}

const SOURCE = [
  "import type { Options } from './types';",
  "import { helper } from './lib/helper.js';",
  'enum Level { Low, High }',
  'export function run(opts: Options, level: Level = Level.High): number {',
  '  const n = helper(opts.size as number);',
  '  throw new Error(`line 6 ${n} ${level}`);',
  '}',
  '',
].join('\n');

describe('compile', () => {
  it('strips types and keeps ESM imports, with line numbers unchanged', () => {
    const out: string = ts.compile(SOURCE, '/p/index.ts', 'esm');
    expect(out).not.toMatch(/: Options|as number|import type/);
    expect(out).toContain("import { helper } from './lib/helper.js';");
    expect(out).toContain('export function run(');
    expect(out.split('\n')).toHaveLength(SOURCE.split('\n').length);
    expect(out.split('\n')[5]).toContain('line 6');
  });

  it('turns imports into require for CommonJS', () => {
    const out: string = ts.compile(SOURCE, '/p/index.ts', 'cjs');
    expect(out).toContain("require('./lib/helper.js')");
    expect(out).not.toMatch(/^\s*import /m);
    expect(out.split('\n')[5]).toContain('line 6');
  });

  it('handles JSX in .tsx', () => {
    const out: string = ts.compile('const el = <div title={"a" as string}>hi</div>;', '/p/a.tsx', 'esm');
    expect(out).toContain('React.createElement');
  });
});

describe('resolution and format', () => {
  it('resolves .js, extensionless and folder imports to .ts files', () => {
    const t = tmp();
    t.file('lib/helper.ts', '');
    t.file('lib/view.tsx', '');
    t.file('lib/dir/index.ts', '');
    t.file('data.json', '{}');
    const at = (spec: string) => ts.resolveRelative(t.root, spec);
    expect(at('./lib/helper.js')).toBe(path.join(t.root, 'lib/helper.ts'));
    expect(at('./lib/helper')).toBe(path.join(t.root, 'lib/helper.ts'));
    expect(at('./lib/view.js')).toBe(path.join(t.root, 'lib/view.tsx'));
    expect(at('./lib/dir')).toBe(path.join(t.root, 'lib/dir/index.ts'));
    expect(at('./data.json')).toBe(path.join(t.root, 'data.json'));
    expect(at('./missing')).toBeNull();
  });

  it('follows package.json "type" and the .mts/.cts extensions', () => {
    const t = tmp();
    const cjs = t.file('a/index.ts', '');
    t.file('b/package.json', '{"type":"module"}');
    const esm = t.file('b/index.ts', '');
    expect(ts.formatOf(cjs)).toBe('cjs');
    expect(ts.formatOf(esm)).toBe('esm');
    expect(ts.formatOf(t.file('a/x.mts', ''))).toBe('esm');
    expect(ts.formatOf(t.file('b/x.cts', ''))).toBe('cjs');
    expect(ts.isTs('a.d.ts')).toBe(false);
  });

  it('builds the ESM import graph with rewritten imports', () => {
    const t = tmp();
    t.file('package.json', '{"type":"module"}');
    const entry = t.file('index.ts', SOURCE);
    t.file('types.ts', 'export interface Options { size: unknown }');
    t.file('lib/helper.ts', "import data from '../data.json';\nexport const helper = (n: number) => n * Object.keys(data).length;");
    t.file('data.json', '{}');
    const out: string = ts.buildEsm(entry);
    expect(out).toBe(path.join(t.root, '.tide/build/index.ts.mjs'));
    const code = fs.readFileSync(out, 'utf8');
    expect(code).toContain("from './lib/helper.ts.mjs'");
    expect(code.split('\n')[5]).toContain('line 6');
    expect(code).toContain(JSON.stringify(`file://${entry}`));
    expect(fs.readFileSync(path.join(t.root, '.tide/build/lib/helper.ts.mjs'), 'utf8')).toContain("from '../../../data.json'");
    // Type-only files are compiled only when something imports a value from them.
    expect(fs.existsSync(path.join(t.root, '.tide/build/types.ts.mjs'))).toBe(false);
    expect(fs.readFileSync(path.join(t.root, '.tide/build/.gitignore'), 'utf8')).toBe('*\n');
  });

  it('maps compiled paths in stack traces back to the source', () => {
    expect(ts.mapStack('at f (file:///p/proj/.tide/build/src/a.ts.mjs:3:7)')).toBe('at f (/p/proj/src/a.ts:3:7)');
    expect(ts.mapStack('at /p/.tide/build/_up/x.tsx.mjs:1:1')).toBe('at /p/../x.tsx:1:1');
    expect(ts.mapStack('at /p/a.js:1:1')).toBe('at /p/a.js:1:1');
  });
});

describe('running .ts in the supervisor', () => {
  // Enums and parameter properties aren't erasable, so a pass shows Sucrase ran
  // (not the host Node's own type stripping).
  const LIB = 'export enum Color { Red = "red" }\nexport class P { constructor(public name: string) {} }\n';
  const MAIN = [
    "import { Color, P } from './lib/util.js';",
    "import helper from './lib/helper';",
    'const who: string = new P(process.argv[2]).name;',
    'console.log(`${who} ${Color.Red} ${helper(2)}`);',
    'if (process.argv[3]) throw new Error("on line 5");',
    '',
  ].join('\n');

  function setup(type?: 'module') {
    const t = tmp();
    const messages: Msg[] = [];
    const supervisor = createSupervisor({ send: (m: Msg) => messages.push(m) });
    supervisor.handle({ type: 'init', root: t.root });
    if (type) t.file('projects/demo/package.json', JSON.stringify({ type }));
    t.file('projects/demo/lib/util.ts', LIB);
    t.file('projects/demo/lib/helper.ts', 'export default function helper(n: number): number { return n * 21; }\n');
    t.file('projects/demo/index.ts', type ? `${MAIN}await Promise.resolve();\n` : MAIN);
    const run = (id: string, args: string[]) => {
      supervisor.handle({ type: 'run', id, runtime: 'node', entry: 'projects/demo/index.ts', cwd: 'projects/demo', args });
      return new Promise<{ code?: number; stdout: string; stderr: string }>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          const exit = messages.find((m) => m.id === id && m.type === 'exit');
          const text = (kind: string) => messages.filter((m) => m.id === id && m.type === kind).map((m) => m.data).join('');
          if (exit) return resolve({ code: exit.code, stdout: text('stdout'), stderr: text('stderr') });
          if (Date.now() - start > 10000) return reject(new Error(`${id} did not exit`));
          setTimeout(check, 10);
        };
        check();
      });
    };
    return { ...t, run };
  }

  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it.each([['CommonJS', undefined], ['ESM', 'module' as const]])('runs a %s project', async (_name, type) => {
    const t = setup(type);
    await expect(t.run('ok', ['ada'])).resolves.toEqual({ code: 0, stdout: 'ada red 42\n', stderr: '' });
    const failed = await t.run('fail', ['ada', 'x']);
    expect(failed.code).toBe(1);
    // The error points at the .ts source, from the project root, on the right line.
    expect(failed.stderr).toContain('Error: on line 5');
    expect(failed.stderr).toMatch(/\/index\.ts:5:\d+/);
    expect(failed.stderr).not.toContain('.tide/build');
  });
});
