/**
 * @jest-environment node
 */
import { createPythonTools } from '../pythonTools';
import { createService } from '../services';
import { ensureServiceBundles, hostPython, hostSnippet, pythonToolsInstalled, stopRuns, supervisorRunner } from '../testing';
import { LintMessage, toDiagnostics } from './lintMessages';

const cwd = process.cwd();
afterEach(() => {
  stopRuns();
  process.chdir(cwd);
});
beforeAll(ensureServiceBundles, 120_000);

describe('format service', () => {
  it('formats with Prettier and the nearest JSON config', async () => {
    const runner = supervisorRunner();
    runner.file('projects/p/.prettierrc', '{"semi": false, "singleQuote": true}');
    const service = createService(runner, { entry: 'tide:format' });
    await expect(service.request('format', { path: 'projects/p/src/a.ts', content: 'const a:string = "x";' })).resolves.toBe("const a: string = 'x'\n");
    await expect(service.request('format', { path: 'projects/q/a.css', content: 'a{color:red}' })).resolves.toBe('a {\n  color: red;\n}\n');
    await expect(service.request('format', { path: 'projects/p/a.js', content: 'let = ;' })).rejects.toThrow(/Unexpected token/);
    service.stop();
  });

  it('lints JavaScript with the recommended ESLint rules', async () => {
    const runner = supervisorRunner();
    const service = createService(runner, { entry: 'tide:format' });
    const messages = await service.request<LintMessage[]>('lint', { path: 'projects/p/a.js', content: 'const x = 1;\nfoo();\nconsole.log(<b/>)' });
    expect(messages).toEqual([
      expect.objectContaining({ line: 1, column: 7, severity: 'warning', message: expect.stringContaining('no-unused-vars') }),
      expect.objectContaining({ line: 2, column: 1, severity: 'error', message: expect.stringContaining('no-undef') }),
    ]);
    await expect(service.request('lint', { path: 'projects/p/a.ts', content: 'let x: number' })).resolves.toEqual([]);
    service.stop();
  });

  it('starts again after it stops', async () => {
    const runner = supervisorRunner();
    const service = createService(runner, { entry: 'tide:format' });
    await service.request('supports', {});
    service.stop();
    await expect(service.request('format', { path: 'projects/p/a.json', content: '{"a":1}' })).resolves.toBe('{ "a": 1 }\n');
    service.stop();
  });
});

describe('lint diagnostics', () => {
  it('turns line and column ranges into offsets', () => {
    const text = 'let a = 1;\nfoo();';
    const [d, e] = toDiagnostics(
      text,
      [
        { line: 2, column: 1, endLine: 2, endColumn: 4, severity: 'error', message: 'no' },
        { line: 1, column: 5, severity: 'warning', message: 'unused' },
      ],
      'eslint',
    );
    expect(text.slice(d.from, d.to)).toBe('foo');
    // Without an end, the word at the position.
    expect(text.slice(e.from, e.to)).toBe('a');
  });
});

const python = hostPython();
const withPython = python && pythonToolsInstalled() ? describe : describe.skip;

withPython('python tools', () => {
  const tools = createPythonTools(hostSnippet(python!));

  it('reports pyflakes warnings and syntax errors', async () => {
    await expect(tools.request('lint', { path: 'a.py', content: 'import os\nprint(x)\n' })).resolves.toEqual([
      { line: 1, column: 1, severity: 'warning', message: "'os' imported but unused" },
      { line: 2, column: 7, severity: 'error', message: "undefined name 'x'" },
    ]);
    const [syntax] = await tools.request<LintMessage[]>('lint', { path: 'a.py', content: 'def f(:\n' });
    expect(syntax).toMatchObject({ line: 1, severity: 'error', message: expect.stringContaining('SyntaxError') });
  });

  it('formats with autopep8', async () => {
    await expect(tools.request('format', { path: 'a.py', content: 'x=1\ndef f( a ):\n  return a\n' })).resolves.toBe('x = 1\n\n\ndef f(a):\n    return a\n');
  });
});
