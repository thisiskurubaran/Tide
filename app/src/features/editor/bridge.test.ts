import { CODE_FONTS, isCodeFont, languageFor, parseFromEditor, parseToEditor } from './bridge';

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
    ['theme.scss', 'scss'],
    ['vars.less', 'less'],
    ['.prettierrc', 'json'],
    ['settings.jsonc', 'json'],
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

  it('accepts setFont only with a known font and a boolean ligatures flag', () => {
    const msg = { type: 'setFont', font: 'fira-code', ligatures: true };
    expect(parseToEditor(JSON.stringify(msg))).toEqual(msg);
    expect(parseToEditor(JSON.stringify({ ...msg, font: 'comic-sans' }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ ...msg, font: 'toString' }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ ...msg, ligatures: 'yes' }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ type: 'setFont' }))).toBeNull();
    // Only the app sends it.
    expect(parseFromEditor(JSON.stringify(msg))).toBeNull();
  });
});

describe('code fonts', () => {
  it('knows the bundled fonts by id', () => {
    expect(Object.keys(CODE_FONTS)).toEqual(['jetbrains-mono', 'fira-code', 'ibm-plex-mono', 'source-code-pro']);
    expect(isCodeFont('ibm-plex-mono')).toBe(true);
    expect(isCodeFont('hasOwnProperty')).toBe(false);
    expect(isCodeFont(undefined)).toBe(false);
  });
});
