import { formatOnSave, lineAt, saveRules } from './saveFormat';
import { createSaveFormatter, forgetFormatting } from './saveFormatting';
import { selectionStore } from './selection';

const rules = (over: Partial<Parameters<typeof formatOnSave>[1]> = {}) => ({ trimTrailingWhitespace: true, insertFinalNewline: true, markdown: false, ...over });

describe('formatOnSave', () => {
  it('trims trailing spaces and tabs and adds a final newline', () => {
    expect(formatOnSave('a  \n\tb\t\n  \nc', rules())).toBe('a\n\tb\n\nc\n');
  });

  it('keeps CRLF line endings', () => {
    expect(formatOnSave('a \r\nb', rules())).toBe('a\r\nb\r\n');
  });

  it('does only what is switched on', () => {
    expect(formatOnSave('a \nb', rules({ insertFinalNewline: false }))).toBe('a\nb');
    expect(formatOnSave('a \nb', rules({ trimTrailingWhitespace: false }))).toBe('a \nb\n');
    expect(formatOnSave('', rules())).toBe('');
  });

  it('keeps Markdown line breaks (two or more spaces after text)', () => {
    expect(formatOnSave('line one  \nline two \n   \nend\t', rules({ markdown: true, insertFinalNewline: false }))).toBe('line one  \nline two\n\nend');
    expect(formatOnSave('line one  \n', rules())).toBe('line one\n');
  });

  it('leaves the line being typed on alone', () => {
    expect(formatOnSave('a \nb ', rules(), 1)).toBe('a\nb ');
    expect(formatOnSave('a \nb ', rules(), 0)).toBe('a \nb\n');
  });
});

it('lineAt counts lines before the offset', () => {
  expect(lineAt('ab\ncd\nef', 0)).toBe(0);
  expect(lineAt('ab\ncd\nef', 3)).toBe(1);
  expect(lineAt('ab\ncd\nef', 99)).toBe(2);
});

it('saveRules lets .editorconfig override the settings', () => {
  expect(saveRules({ trimTrailingWhitespace: true }, { trimTrailingWhitespace: false, insertFinalNewline: true }, false)).toEqual({
    trimTrailingWhitespace: false,
    insertFinalNewline: true,
    markdown: false,
  });
  expect(saveRules({}, {}, true)).toEqual({ trimTrailingWhitespace: false, insertFinalNewline: false, markdown: true });
});

describe('createSaveFormatter', () => {
  const disk: Record<string, string> = {};
  const read = async (_project: string, path: string) => disk[path] ?? null;
  let settings = { trimTrailingWhitespace: false, insertFinalNewline: false };
  const format = createSaveFormatter(read, () => settings);

  beforeEach(() => {
    for (const k of Object.keys(disk)) delete disk[k];
    forgetFormatting('p');
    settings = { trimTrailingWhitespace: false, insertFinalNewline: false };
    selectionStore.setState({ project: null, path: null, anchor: 0, head: 0 });
  });

  it('follows the settings when there is no .editorconfig', async () => {
    expect(await format('p', 'a.js', 'x \n', 'explicit')).toBe('x \n');
    settings = { trimTrailingWhitespace: true, insertFinalNewline: true };
    expect(await format('p', 'a.js', 'x \ny', 'explicit')).toBe('x\ny\n');
  });

  it('lets .editorconfig override the settings for the file only', async () => {
    disk['.editorconfig'] = 'root = true\n[*.py]\ntrim_trailing_whitespace = true\n[*.md]\ninsert_final_newline = false';
    expect(await format('p', 'a.py', 'x ', 'explicit')).toBe('x');
    expect(await format('p', 'a.js', 'x ', 'explicit')).toBe('x ');
    settings = { trimTrailingWhitespace: false, insertFinalNewline: true };
    expect(await format('p', 'notes.md', 'x', 'explicit')).toBe('x');
  });

  it('leaves the cursor line alone on autosave only', async () => {
    settings = { trimTrailingWhitespace: true, insertFinalNewline: true };
    selectionStore.setState({ project: 'p', path: 'a.js', anchor: 6, head: 6 });
    expect(await format('p', 'a.js', 'one \ntwo ', 'auto')).toBe('one\ntwo ');
    expect(await format('p', 'a.js', 'one \ntwo ', 'flush')).toBe('one\ntwo\n');
  });

  it('reads .editorconfig again after one is saved', async () => {
    settings = { trimTrailingWhitespace: true, insertFinalNewline: false };
    expect(await format('p', 'a.js', 'x ', 'explicit')).toBe('x');
    disk['.editorconfig'] = '[*]\ntrim_trailing_whitespace = false';
    await format('p', '.editorconfig', disk['.editorconfig'], 'explicit');
    expect(await format('p', 'a.js', 'x ', 'explicit')).toBe('x ');
  });
});
