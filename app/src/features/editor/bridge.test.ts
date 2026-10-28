import { languageFor, parseFromEditor, parseToEditor } from './bridge';

describe('languageFor', () => {
  it.each([
    ['index.js', 'javascript'],
    ['src/app.MJS', 'javascript'],
    ['App.tsx', 'tsx'],
    ['lib/util.ts', 'typescript'],
    ['main.py', 'python'],
    ['package.json', 'json'],
    ['index.html', 'html'],
    ['styles.css', 'css'],
    ['README.md', 'markdown'],
    ['Makefile', 'plain'],
    ['.gitignore', 'plain'],
    ['notes.txt', 'plain'],
    ['dir.v2/file', 'plain'],
  ])('%s -> %s', (path, lang) => {
    expect(languageFor(path)).toBe(lang);
  });
});

describe('message parsing', () => {
  it('accepts known messages in each direction', () => {
    expect(parseFromEditor(JSON.stringify({ type: 'change', path: 'a.js', content: 'x' }))).toEqual({
      type: 'change',
      path: 'a.js',
      content: 'x',
    });
    expect(parseToEditor(JSON.stringify({ type: 'key', key: 'left' }))).toEqual({ type: 'key', key: 'left' });
  });

  it('rejects unknown types, wrong direction and non-JSON', () => {
    expect(parseFromEditor('{"type":"open"}')).toBeNull();
    expect(parseToEditor('{"type":"ready"}')).toBeNull();
    expect(parseFromEditor('not json')).toBeNull();
    expect(parseFromEditor('null')).toBeNull();
    expect(parseFromEditor('"ready"')).toBeNull();
  });
});
