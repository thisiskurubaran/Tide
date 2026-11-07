/**
 * @jest-environment node
 */
import type { Diagnostic } from '../../extensions/diagnostics';
import type { ChatRequest, ChatResult } from './providers/types';
import {
  ContextSource,
  excerpt,
  formatTokens,
  gatherContext,
  importsOf,
  MAX_CONTEXT_CHARS,
  MAX_RELATED_FILES,
  MAX_TARGET_CHARS,
  parseFixReply,
  requestFix,
  resolveImport,
  runTarget,
  validateEdits,
} from './fix';

jest.mock('./client', () => {
  const { AiError } = jest.requireActual('./providers/types');
  return { AiError, chat: jest.fn() };
});

const diag = (line: number, message: string, severity: Diagnostic['severity'] = 'error', source = 'ts'): Diagnostic => ({
  from: 0,
  to: 0,
  line,
  column: 1,
  severity,
  message,
  source,
});

function source(files: Record<string, string>, problems: Record<string, Diagnostic[]> = {}): ContextSource {
  return {
    files: Object.keys(files),
    read: async (p) => files[p] ?? null,
    problems: (p) => problems[p] ?? [],
  };
}

describe('parseFixReply', () => {
  it('reads the explanation and edits for several files', () => {
    const reply = `<explanation>
\`sum\` subtracts instead of adding.
</explanation>
<edit path="src/sum.js">
<old>
  return a - b;
</old>
<new>
  return a + b;
</new>
</edit>
<edit path="./src/index.js">
<old>sum(1)</old>
<new>sum(1, 2)</new>
</edit>`;
    const parsed = parseFixReply(reply);
    expect(parsed.explanation).toBe('`sum` subtracts instead of adding.');
    expect(parsed.malformed).toBe(0);
    expect(parsed.edits).toEqual([
      { path: 'src/sum.js', old: '  return a - b;', new: '  return a + b;' },
      { path: 'src/index.js', old: 'sum(1)', new: 'sum(1, 2)' },
    ]);
  });

  it('takes the explanation without tags, fenced bodies and several pairs in one edit', () => {
    const parsed = parseFixReply(`It was off by one.

<edit path='a.py'><old>
\`\`\`python
x = 1
\`\`\`
</old><new>x = 2</new><old>y</old><new/></edit>`);
    expect(parsed.explanation).toBe('It was off by one.');
    expect(parsed.edits).toEqual([
      { path: 'a.py', old: 'x = 1', new: 'x = 2' },
      { path: 'a.py', old: 'y', new: '' },
    ]);
  });

  it('counts malformed blocks: no path, unsafe path, missing <new>, cut off', () => {
    const parsed = parseFixReply(`<explanation>x</explanation>
<edit><old>a</old><new>b</new></edit>
<edit path="../etc/passwd"><old>a</old><new>b</new></edit>
<edit path="a.js"><old>a</old></edit>
<edit path="b.js"><old>ok</old><new>fine</new></edit>
<edit path="c.js"><old>cut`);
    expect(parsed.edits).toEqual([{ path: 'b.js', old: 'ok', new: 'fine' }]);
    expect(parsed.malformed).toBe(4);
  });

  it('accepts a last edit missing only its </edit>', () => {
    const parsed = parseFixReply('<edit path="a.js"><old>a</old><new>b</new>');
    expect(parsed.edits).toHaveLength(1);
    expect(parsed.malformed).toBe(0);
  });
});

describe('validateEdits', () => {
  const files: Record<string, string> = {
    'a.js': 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n',
    'b.js': 'export {};\n',
  };
  const contentOf = (p: string) => files[p] ?? null;

  it('keeps edits whose old text occurs exactly once', () => {
    const { changes, dropped } = validateEdits(
      [
        { path: 'a.js', old: 'const b = 2;', new: 'const b = 3;' },
        // "= 1;" is there twice.
        { path: 'a.js', old: '= 1;', new: '= 9;' },
        // Not there at all.
        { path: 'a.js', old: 'nope', new: 'x' },
        // Not a file we know.
        { path: 'c.js', old: 'x', new: 'y' },
        { path: 'b.js', old: 'export {};', new: 'export const b = 1;' },
      ],
      contentOf,
    );
    expect(dropped).toBe(3);
    expect(changes).toEqual([
      {
        path: 'a.js',
        before: files['a.js'],
        after: 'const a = 1;\nconst b = 3;\nconst a2 = 1;\n',
      },
      { path: 'b.js', before: files['b.js'], after: 'export const b = 1;\n' },
    ]);
  });

  it('applies several edits in one file against its original text, dropping overlaps', () => {
    const { changes, dropped } = validateEdits(
      [
        { path: 'a.js', old: 'const b = 2;', new: 'let b = 2;' },
        { path: 'a.js', old: 'const a2', new: 'let a2' },
        { path: 'a.js', old: 'b = 2;\nconst a2', new: 'oops' },
      ],
      contentOf,
    );
    expect(dropped).toBe(1);
    expect(changes[0].after).toBe('const a = 1;\nlet b = 2;\nlet a2 = 1;\n');
  });

  it('tolerates a copied line-number gutter and CRLF files', () => {
    const crlf = 'one\r\ntwo\r\nthree\r\n';
    const { changes, dropped } = validateEdits(
      [
        { path: 'a.js', old: '  2 | const b = 2;', new: '  2 | const b = 5;' },
        { path: 'w.txt', old: 'one\ntwo', new: 'one\n2' },
      ],
      (p) => (p === 'w.txt' ? crlf : contentOf(p)),
    );
    expect(dropped).toBe(0);
    expect(changes.find((c) => c.path === 'a.js')?.after).toContain('const b = 5;');
    expect(changes.find((c) => c.path === 'w.txt')?.after).toBe('one\r\n2\r\nthree\r\n');
  });

  it('only lets an empty old text fill an empty file', () => {
    const { changes, dropped } = validateEdits(
      [
        { path: 'a.js', old: '', new: 'x' },
        { path: 'e.js', old: '', new: 'hello\n' },
      ],
      (p) => (p === 'e.js' ? '' : contentOf(p)),
    );
    expect(dropped).toBe(1);
    expect(changes).toEqual([{ path: 'e.js', before: '', after: 'hello\n' }]);
  });
});

describe('imports', () => {
  const files = [
    'src/a.ts',
    'src/b.ts',
    'src/util/index.ts',
    'src/c.tsx',
    'lib/m.py',
    'lib/__init__.py',
    'pkg/sub/__init__.py',
    'app.py',
    'styles/_vars.scss',
    'main.scss',
    'index.html',
    'app.js',
    'data.json',
  ];

  it('finds and resolves JS/TS imports, skipping packages', () => {
    const code = `import React from 'react';\nimport { b } from './b';\nimport type { U } from "./util";\nexport * from './c';\nconst d = require('../data.json');\nimport('./missing');`;
    const specs = importsOf('src/a.ts', code);
    expect(specs).toEqual(['react', './b', './util', './c', '../data.json', './missing']);
    expect(specs.map((s) => resolveImport(s, 'src/a.ts', files))).toEqual([null, 'src/b.ts', 'src/util/index.ts', 'src/c.tsx', 'data.json', null]);
    expect(resolveImport('./b.js', 'src/a.ts', files)).toBe('src/b.ts');
    expect(resolveImport('@/b', 'src/c.tsx', files)).toBe('src/b.ts');
    expect(resolveImport('../../x', 'src/a.ts', files)).toBeNull();
  });

  it('resolves Python, SCSS and HTML imports', () => {
    expect(importsOf('app.py', 'import os, lib.m\nfrom pkg.sub import thing\nfrom . import lib\n')).toEqual(['pkg.sub', '.lib', 'os', 'lib.m']);
    expect(resolveImport('lib.m', 'app.py', files)).toBe('lib/m.py');
    expect(resolveImport('pkg.sub', 'app.py', files)).toBe('pkg/sub/__init__.py');
    expect(resolveImport('.lib', 'app.py', files)).toBe('lib/__init__.py');
    expect(resolveImport('os', 'app.py', files)).toBeNull();
    expect(resolveImport('styles/vars', 'main.scss', files)).toBe('styles/_vars.scss');
    expect(importsOf('index.html', '<script src="app.js"></script><script src="https://cdn/x.js"></script>')).toEqual(['app.js', 'https://cdn/x.js']);
    expect(resolveImport('app.js', 'index.html', files)).toBe('app.js');
    expect(resolveImport('https://cdn/x.js', 'index.html', files)).toBeNull();
  });
});

describe('gatherContext', () => {
  it('sends the file with numbered lines, the line problems and imported files', async () => {
    const ctx = await gatherContext(
      { kind: 'problem', path: 'src/a.ts', line: 2 },
      source(
        {
          'src/a.ts': "import { b } from './b';\nconst x: number = b;\n",
          'src/b.ts': "export const b = 'b';\n",
        },
        {
          'src/a.ts': [diag(2, 'Type string is not assignable'), diag(1, 'other')],
        },
      ),
    );
    expect(ctx.files.map((f) => [f.path, f.role, f.partial])).toEqual([
      ['src/a.ts', 'target', false],
      ['src/b.ts', 'related', false],
    ]);
    expect(ctx.files[0].shown.split('\n')[1]).toBe('2 | const x: number = b;');
    expect(ctx.problems.map((p) => p.message)).toEqual(['Type string is not assignable']);
  });

  it('stays inside the limits: a window around the problem, at most 3 related files, 60k in all', async () => {
    const big = Array.from({ length: 5000 }, (_, i) => `const line${i} = ${'x'.repeat(30)};`).join('\n');
    const files: Record<string, string> = {
      'main.js': `${['a', 'b', 'c', 'd', 'e'].map((n) => `import './${n}.js';`).join('\n')}\n${big}`,
    };
    for (const n of ['a', 'b', 'c', 'd', 'e']) files[`${n}.js`] = 'y'.repeat(30_000);
    const ctx = await gatherContext({ kind: 'problem', path: 'main.js', line: 3000 }, source(files, { 'main.js': [diag(3000, 'boom')] }));
    const target = ctx.files[0];
    expect(target.partial).toBe(true);
    expect(target.startLine).toBeLessThanOrEqual(3000);
    expect(target.endLine).toBeGreaterThanOrEqual(3000);
    expect(target.shown.length).toBeLessThanOrEqual(MAX_TARGET_CHARS);
    expect(ctx.files.length - 1).toBeLessThanOrEqual(MAX_RELATED_FILES);
    expect(ctx.chars).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(ctx.files.reduce((n, f) => n + f.shown.length, 0)).toBe(ctx.chars);
  });

  it('keeps a huge single line within budget', () => {
    const ex = excerpt('z'.repeat(100_000), [1], 1000);
    expect(ex.shown.length).toBe(1000);
    expect(ex.partial).toBe(true);
  });

  it('finds the file a run error points at', async () => {
    const output = 'Traceback (most recent call last):\n  File "/x/projects/demo/app.py", line 3, in <module>\n    main()\nNameError: name main is not defined\n';
    expect(runTarget(output, 'demo', ['app.py'])).toEqual({
      path: 'app.py',
      line: 3,
    });
    const ctx = await gatherContext({ kind: 'run', output }, source({ 'app.py': 'print(1)\n\nmain()\n' }), 'demo');
    expect(ctx.path).toBe('app.py');
    expect(ctx.line).toBe(3);
    expect(ctx.output).toContain('NameError');
  });
});

describe('requestFix', () => {
  const files = { 'a.js': 'const n = 1\nconsole.log(m)\n' };
  const reply = (text: string, stop: ChatResult['stop'] = 'end'): ChatResult => ({
    text,
    stop,
    usage: { inputTokens: 1500, outputTokens: 300 },
  });

  it('asks the chat job and returns validated changes', async () => {
    const chat = jest.fn(async (_req: ChatRequest) =>
      reply(
        '<explanation>`m` is undefined.</explanation>\n<edit path="a.js"><old>console.log(m)</old><new>console.log(n)</new></edit>\n<edit path="a.js"><old>zzz</old><new>q</new></edit>',
      ),
    );
    const ctx = await gatherContext({ kind: 'problem', path: 'a.js', line: 2 }, source(files, { 'a.js': [diag(2, 'm is not defined')] }));
    const result = await requestFix(ctx, { chat });
    expect(chat.mock.calls[0][0].job).toBe('chat');
    expect(chat.mock.calls[0][0].messages[0].content).toContain('m is not defined');
    expect(result.explanation).toBe('`m` is undefined.');
    expect(result.changes).toEqual([
      {
        path: 'a.js',
        before: files['a.js'],
        after: 'const n = 1\nconsole.log(n)\n',
      },
    ]);
    expect(result.dropped).toBe(1);
    expect(formatTokens(result.usage)).toBe('1.8k tokens');
  });

  it('says the last attempt was rejected on retry, and asks for words only on explain', async () => {
    const chat = jest.fn(async (_req: ChatRequest) => reply('<explanation>Because.</explanation>'));
    const ctx = await gatherContext({ kind: 'file', path: 'a.js' }, source(files, { 'a.js': [diag(2, 'm')] }));
    await requestFix(ctx, { chat, mode: 'retry', previous: 'Rename m' });
    expect(chat.mock.calls[0][0].messages[0].content).toMatch(/rejected[\s\S]*Rename m/);
    const explained = await requestFix(ctx, { chat, mode: 'explain' });
    expect(chat.mock.calls[1][0].system).toMatch(/Don't give edits/);
    expect(explained).toMatchObject({
      explanation: 'Because.',
      changes: [],
      dropped: 0,
    });
  });

  it('turns a refusal into an AiError', async () => {
    const ctx = await gatherContext({ kind: 'file', path: 'a.js' }, source(files));
    await expect(
      requestFix(ctx, {
        chat: async () => ({ ...reply(''), stop: 'refusal', refusal: 'no' }),
      }),
    ).rejects.toMatchObject({ kind: 'refusal' });
  });
});
