/**
 * @jest-environment node
 */
/// <reference types="node" />
import { execFileSync } from 'child_process';
import path from 'path';

import { defaultRuffSettings, findRuffSettings, parseRuffConfig, RuffDiagnostic, ruffDiagnostics, RuffSettings, toLintMessages } from './ruff';
import { parseToml } from './toml';

describe('TOML', () => {
  it('reads tables, dotted keys, strings, numbers, arrays and inline tables', () => {
    const doc = parseToml(`
# comment
title = "a \\"quoted\\" \\u00e9" # trailing
[tool.ruff]
line-length = 100
lint.select = [
  "E", # errors
  'F',
]
[tool.ruff.format]
quote-style = 'single'
skip-magic-trailing-comma = true
[project]
description = """
two
lines"""
authors = [{ name = "A", email = "a@b.c" }]
version = 1_000
when = 1979-05-27 07:32:00Z
pi = 3.14
[[tool.other]]
ignored = 1
`);
    expect(doc.title).toBe('a "quoted" é');
    expect(doc.tool).toEqual({ ruff: { 'line-length': 100, lint: { select: ['E', 'F'] }, format: { 'quote-style': 'single', 'skip-magic-trailing-comma': true } } });
    expect(doc.project).toEqual({ description: 'two\nlines', authors: [{ name: 'A', email: 'a@b.c' }], version: 1000, when: '1979-05-27 07:32:00Z', pi: 3.14 });
  });

  it('skips lines it cannot read', () => {
    expect(parseToml('a = @@@\nb = 2\nc = "unclosed\nd = true')).toEqual({ b: 2, d: true });
  });
});

describe('Ruff settings', () => {
  it("defaults to Ruff's rules", () => {
    expect(defaultRuffSettings()).toEqual({ lint: { select: ['E4', 'E7', 'E9', 'F'] } });
  });

  it('reads ruff.toml, top-level or under [lint]', () => {
    expect(parseRuffConfig('ruff.toml', 'line-length = 88\nselect = ["E", "W"]\nignore = ["E501"]')).toEqual({
      'line-length': 88,
      lint: { select: ['E', 'W'], ignore: ['E501'] },
    });
    expect(parseRuffConfig('.ruff.toml', '[lint]\nextend-select = ["I"]\n[format]\nindent-style = "tab"\nwhatever = 1')).toEqual({
      lint: { select: ['E4', 'E7', 'E9', 'F'], 'extend-select': ['I'] },
      format: { 'indent-style': 'tab' },
    });
  });

  it('reads [tool.ruff] from pyproject.toml, and nothing without it', () => {
    const pyproject = '[project]\nname = "x"\n\n[tool.ruff]\nline-length = 120\ntarget-version = "py311"\n\n[tool.ruff.lint]\nselect = ["F"]\nper-file-ignores = { "__init__.py" = ["F401"] }\n';
    expect(parseRuffConfig('pyproject.toml', pyproject)).toEqual({ 'line-length': 120, 'target-version': 'py311', lint: { select: ['F'] } });
    expect(parseRuffConfig('pyproject.toml', '[project]\nname = "x"\n')).toBeNull();
  });

  it('drops values of the wrong type', () => {
    expect(parseRuffConfig('ruff.toml', 'line-length = "long"\nselect = "E"\n[format]\nquote-style = "fancy"')).toEqual(defaultRuffSettings());
  });

  it('uses the nearest config up to the project root', async () => {
    const files: Record<string, string> = {
      'pyproject.toml': '[tool.ruff]\nline-length = 70',
      'pkg/pyproject.toml': '[project]\nname = "pkg"',
      'pkg/sub/ruff.toml': 'line-length = 90',
    };
    const read = async (p: string) => files[p] ?? null;
    await expect(findRuffSettings('pkg/sub/a.py', read)).resolves.toMatchObject({ 'line-length': 90 });
    // pkg/pyproject.toml has no [tool.ruff], so the root's applies.
    await expect(findRuffSettings('pkg/b.py', read)).resolves.toMatchObject({ 'line-length': 70 });
    await expect(findRuffSettings('c.py', async () => null)).resolves.toEqual(defaultRuffSettings());
  });
});

describe('Ruff diagnostics', () => {
  const content = 'import os\nprint(x)\ndef f(:\n';
  const items: RuffDiagnostic[] = [
    { code: 'F401', message: '`os` imported but unused', start_location: { row: 1, column: 8 }, end_location: { row: 1, column: 10 } },
    { code: 'F821', message: 'Undefined name `x`', start_location: { row: 2, column: 7 }, end_location: { row: 2, column: 8 } },
    { code: 'invalid-syntax', message: 'Expected a parameter or the end of the parameter list', start_location: { row: 3, column: 7 }, end_location: { row: 3, column: 8 } },
    { code: 'E711', message: 'Comparison to `None`', start_location: { row: 2, column: 1 }, end_location: { row: 2, column: 1 } },
  ];

  it('maps codes, positions and severities', () => {
    expect(toLintMessages(items.slice(0, 2))).toEqual([
      { line: 1, column: 8, endLine: 1, endColumn: 10, severity: 'warning', message: 'F401 `os` imported but unused' },
      { line: 2, column: 7, endLine: 2, endColumn: 8, severity: 'error', message: 'F821 Undefined name `x`' },
    ]);
    const [unused, undef, syntax, empty] = ruffDiagnostics(content, items);
    expect(unused).toMatchObject({ line: 1, column: 8, severity: 'warning', source: 'ruff', message: 'F401 `os` imported but unused' });
    expect(content.slice(unused.from, unused.to)).toBe('os');
    expect(content.slice(undef.from, undef.to)).toBe('x');
    expect(syntax).toMatchObject({ severity: 'error', source: 'ruff', message: 'SyntaxError: Expected a parameter or the end of the parameter list' });
    expect(content.slice(syntax.from, syntax.to)).toBe(':');
    // An empty range underlines the word there.
    expect(content.slice(empty.from, empty.to)).toBe('print');
  });

  // The real module, run in Node, with settings from a config file.
  it('matches what the Ruff wasm build reports', () => {
    const glue = path.join(process.cwd(), 'node_modules/@astral-sh/ruff-wasm-web/ruff_wasm.js');
    const run = (settings: RuffSettings, source: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import fs from 'fs'; import { initSync, Workspace } from ${JSON.stringify(glue)};
             initSync({ module: fs.readFileSync(${JSON.stringify(glue.replace(/\.js$/, '_bg.wasm'))}) });
             const [settings, source] = JSON.parse(fs.readFileSync(0, 'utf8'));
             const w = new Workspace(settings, 1);
             console.log(JSON.stringify({ check: w.check(source), format: w.format(source) }));`,
          ],
          { input: JSON.stringify([settings, source]) },
        ).toString(),
      ) as { check: RuffDiagnostic[]; format: string };
    const source = 'import os\nprint(x);\nl = "a"\n';
    const plain = run(defaultRuffSettings(), source);
    expect(ruffDiagnostics(source, plain.check).map((d) => d.message).sort()).toEqual([
      'E703 Statement ends with an unnecessary semicolon',
      'E741 Ambiguous variable name: `l`',
      'F401 `os` imported but unused',
      'F821 Undefined name `x`',
    ]);
    expect(plain.format).toBe('import os\n\nprint(x)\nl = "a"\n');
    const configured = run(parseRuffConfig('ruff.toml', 'lint.ignore = ["E741", "E703"]\n[format]\nquote-style = "single"')!, source);
    expect(configured.check.map((d) => d.code).sort()).toEqual(['F401', 'F821']);
    expect(configured.format).toBe("import os\n\nprint(x)\nl = 'a'\n");
  });
});
