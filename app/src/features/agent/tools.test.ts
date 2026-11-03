import { AGENT_TOOLS, commandKey, isTestCommand, numberLines, replaceExact, safePath, tail, ToolError } from './tools';
import { testEnv } from './testUtils';

const tool = (name: string) => AGENT_TOOLS.find((t) => t.spec.name === name)!;
const run = (env: ReturnType<typeof testEnv>['env'], name: string, input: Record<string, unknown>) => tool(name).run(input, env);

describe('safePath', () => {
  it('accepts project-relative paths', () => {
    expect(safePath('src/app.js')).toBe('src/app.js');
    expect(safePath('./src//app.js')).toBe('src/app.js');
    expect(safePath('.', { allowRoot: true })).toBe('');
  });

  it.each(['/etc/passwd', '../other/x.js', 'src/../../x', '~/x', 'C:/x', 'src\\x.js', '', 42])('rejects %p', (p) => {
    expect(() => safePath(p)).toThrow(ToolError);
  });

  it('keeps writes out of tool-managed folders', async () => {
    const { env } = testEnv();
    await expect(run(env, 'write_file', { path: 'node_modules/x/index.js', content: '' })).rejects.toThrow(/managed/);
    await expect(run(env, 'write_file', { path: '.git/config', content: '' })).rejects.toThrow(/managed/);
    await expect(run(env, 'read_file', { path: '../secret' })).rejects.toThrow(/leaves the project/);
  });
});

describe('replaceExact', () => {
  it('replaces a single exact match', () => {
    expect(replaceExact('a = 1;\nb = 2;\n', 'b = 2;', 'b = 3;')).toBe('a = 1;\nb = 3;\n');
  });

  it('errors when not found, with a whitespace hint', () => {
    expect(() => replaceExact('  foo();\n', 'bar()', 'x')).toThrow(/wasn't found/);
    expect(() => replaceExact('  foo();\n', '\tfoo();', 'x')).toThrow(/whitespace/);
  });

  it('errors when ambiguous', () => {
    expect(() => replaceExact('x\nx\nx\n', 'x', 'y')).toThrow(/appears 3 times/);
  });

  it('errors on empty old_text', () => {
    expect(() => replaceExact('x', '', 'y')).toThrow(/empty/);
  });

  it('treats $ in the replacement literally', () => {
    expect(replaceExact('a', 'a', '$&$1')).toBe('$&$1');
  });
});

describe('tools over the project', () => {
  it('edit_file stages the change and never writes disk', async () => {
    const t = testEnv({ 'src/a.js': 'const a = 1;\nconst b = 2;\n' });
    const out = await run(t.env, 'edit_file', { path: 'src/a.js', old_text: 'const b = 2;', new_text: 'const b = 3;\nconst c = 4;' });
    expect(out.isError).toBeUndefined();
    expect(out.view).toEqual({ verb: 'Edited', added: 2, removed: 1 });
    expect(t.disk.get('src/a.js')).toBe('const a = 1;\nconst b = 2;\n');
    expect(t.writes).toEqual([]);
    expect(t.changes.getState().byProject.demo['src/a.js'].proposed).toBe('const a = 1;\nconst b = 3;\nconst c = 4;\n');
  });

  it('edit_file errors for a missing file or text', async () => {
    const t = testEnv({ 'a.js': 'x\n' });
    await expect(run(t.env, 'edit_file', { path: 'b.js', old_text: 'x', new_text: 'y' })).rejects.toThrow(/doesn't exist/);
    await expect(run(t.env, 'edit_file', { path: 'a.js', old_text: 'nope', new_text: 'y' })).rejects.toThrow(/wasn't found/);
  });

  it('read_file shows the pending version with line numbers', async () => {
    const t = testEnv({ 'a.js': 'one\ntwo\n' });
    await run(t.env, 'edit_file', { path: 'a.js', old_text: 'two', new_text: 'TWO' });
    const out = await run(t.env, 'read_file', { path: 'a.js' });
    expect(out.content).toBe('a.js (your pending version): lines 1-2 of 2\n1\tone\n2\tTWO');
    const part = await run(t.env, 'read_file', { path: 'a.js', start_line: 2, end_line: 2 });
    expect(part.content).toContain('2\tTWO');
    expect(part.content).not.toContain('one');
  });

  it('write_file creates new files as pending, and edits after that build on it', async () => {
    const t = testEnv();
    const out = await run(t.env, 'write_file', { path: 'lib/new.js', content: 'a\n' });
    expect(out.view?.verb).toBe('Created');
    await run(t.env, 'edit_file', { path: 'lib/new.js', old_text: 'a', new_text: 'b' });
    const c = t.changes.getState().byProject.demo['lib/new.js'];
    expect(c.original).toBeNull();
    expect(c.proposed).toBe('b\n');
    expect((await run(t.env, 'list_files', {})).content).toBe('lib/new.js');
  });

  it('list_files filters by folder', async () => {
    const t = testEnv({ 'src/a.js': '', 'src/b/c.js': '', 'README.md': '' });
    expect((await run(t.env, 'list_files', { dir: 'src' })).content).toBe('src/a.js\nsrc/b/c.js');
    expect((await run(t.env, 'list_files', { dir: 'nope' })).content).toMatch(/No files/);
  });

  it('search covers pending changes and reports bad regexes', async () => {
    const t = testEnv({ 'a.js': 'hello\n', 'b.js': 'other\n' });
    await run(t.env, 'edit_file', { path: 'b.js', old_text: 'other', new_text: 'hello again' });
    const out = await run(t.env, 'search', { query: 'hello' });
    expect(out.content).toBe('2 matches in 2 files:\na.js:1: hello\nb.js:1: hello again');
    await expect(run(t.env, 'search', { query: '(', regex: true })).rejects.toThrow(/Invalid regular expression/);
  });

  it('run_command writes pending changes to disk first, then reports output and exit code', async () => {
    let seen: string | undefined;
    const t = testEnv({ 'a.js': 'old\n', 'package.json': '{}' }, () => {
      seen = t.disk.get('a.js');
      return { output: 'Tests: 1 failed, 3 passed\n', code: 1, timedOut: false };
    });
    await run(t.env, 'edit_file', { path: 'a.js', old_text: 'old', new_text: 'new' });
    const out = await run(t.env, 'run_command', { command: 'npm test' });
    expect(seen).toBe('new\n');
    expect(out.content).toBe('$ npm test\nTests: 1 failed, 3 passed\n[exit code 1]');
    expect(out.isError).toBe(true);
    expect(out.test).toEqual({ command: 'npm test', code: 1, timedOut: false, summary: 'Tests: 1 failed, 3 passed' });
    // Still pending, but marked as on disk.
    const c = t.changes.getState().byProject.demo['a.js'];
    expect(c.disk).toBe('new\n');
    expect(c.original).toBe('old\n');
  });

  it('run_command keeps only the tail of long output and notes timeouts', async () => {
    const t = testEnv({}, () => ({ output: 'x'.repeat(10_000), code: null, timedOut: true }));
    const out = await run(t.env, 'run_command', { command: 'node loop.js' });
    expect(out.content).toMatch(/4000 earlier characters cut/);
    expect(out.content).toMatch(/stopped after 120 s/);
    expect(out.test).toBeUndefined();
  });

  it('finish carries the summary', async () => {
    const t = testEnv();
    expect(await run(t.env, 'finish', { summary: ' Fixed it. ' })).toEqual({ content: 'Finished.', finish: 'Fixed it.' });
  });
});

describe('helpers', () => {
  it('numberLines pads and cuts', () => {
    expect(numberLines('a\nb\n').text).toBe('1\ta\n2\tb');
    const big = numberLines(Array.from({ length: 2500 }, () => 'x').join('\n'));
    expect(big.to).toBe(2000);
    expect(big.cut).toBe(true);
  });

  it('commandKey is the first word', () => {
    expect(commandKey('  npm test -- --watch')).toBe('npm');
    expect(commandKey('git status')).toBe('git');
  });

  it('recognizes test commands', () => {
    expect(isTestCommand('npm test')).toBe(true);
    expect(isTestCommand('npm run test:unit')).toBe(true);
    expect(isTestCommand('npx jest src')).toBe(true);
    expect(isTestCommand('node test.js')).toBe(true);
    expect(isTestCommand('python test_app.py')).toBe(true);
    expect(isTestCommand('node src/sum.test.js')).toBe(true);
    expect(isTestCommand('npm install')).toBe(false);
    expect(isTestCommand('npm install @testing-library/react')).toBe(false);
    expect(isTestCommand('node index.js')).toBe(false);
  });

  it('tail keeps short text as is', () => {
    expect(tail('abc', 10)).toBe('abc');
  });
});
