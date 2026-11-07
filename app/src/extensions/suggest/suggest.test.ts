import { dependenciesOf, suggestExtension } from './suggest';

const facts = (files: string[], deps: string[] = [], isGitRepo = false) => ({ files, dependencies: deps, isGitRepo });

describe('extension suggestions', () => {
  it('offers the most useful extension that fits', () => {
    expect(suggestExtension(facts(['src/a.js', '.eslintrc.json']), [], [])?.id).toBe('format-lint');
    expect(suggestExtension(facts(['index.js'], ['prettier']), [], [])?.reason).toContain('Prettier');
    expect(suggestExtension(facts(['src/a.ts', 'tsconfig.json']), [], [])?.id).toBe('intellisense');
    expect(suggestExtension(facts(['main.py', 'lib.py']), ['format-lint'], [])?.id).toBe('intellisense');
    expect(suggestExtension(facts(['index.js'], [], true), [], [])?.id).toBe('git-pro');
    expect(suggestExtension(facts(['.vscode/launch.json']), [], [])?.id).toBe('debugger');
  });

  it('skips installed and dismissed ones, and offers nothing when nothing fits', () => {
    const f = facts(['.eslintrc.json', 'tsconfig.json'], [], true);
    expect(suggestExtension(f, ['format-lint'], [])?.id).toBe('intellisense');
    expect(suggestExtension(f, ['format-lint'], ['intellisense'])?.id).toBe('git-pro');
    expect(suggestExtension(f, ['format-lint', 'intellisense', 'git-pro'], [])).toBeNull();
    expect(suggestExtension(facts(['index.html', 'main.py']), ['format-lint'], [])).toBeNull();
  });

  it('offers Format & Lint (Ruff) for Python projects', () => {
    expect(suggestExtension(facts(['main.py']), [], [])).toEqual({ id: 'format-lint', reason: expect.stringContaining('Ruff') });
    expect(suggestExtension(facts(['pyproject.toml']), [], [])?.id).toBe('format-lint');
    expect(suggestExtension(facts(['tools/ruff.toml']), [], [])?.id).toBe('format-lint');
    expect(suggestExtension(facts(['index.html', 'notes.txt']), [], [])).toBeNull();
  });

  it('reads dependencies from package.json', () => {
    expect(dependenciesOf(JSON.stringify({ dependencies: { express: '4' }, devDependencies: { eslint: '9' } }))).toEqual(['express', 'eslint']);
    expect(dependenciesOf('{nope')).toEqual([]);
    expect(dependenciesOf(null)).toEqual([]);
  });
});
