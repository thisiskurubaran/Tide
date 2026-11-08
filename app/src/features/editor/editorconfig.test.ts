import { globMatches, loadFileFormatting, parseEditorConfig, resolveProperties, toFileFormatting } from './editorconfig';

describe('parseEditorConfig', () => {
  it('reads root, sections and properties, skipping comments', () => {
    const c = parseEditorConfig(['# top', 'root = true', '', '[*]', 'Indent_Style = space', '; note', 'indent_size=2', '[*.py]', 'indent_size = 4'].join('\r\n'));
    expect(c.root).toBe(true);
    expect(c.sections).toEqual([
      { glob: '*', props: { indent_style: 'space', indent_size: '2' } },
      { glob: '*.py', props: { indent_size: '4' } },
    ]);
  });

  it('is not root unless it says so', () => {
    expect(parseEditorConfig('[*]\nroot = true').root).toBe(false);
  });
});

describe('globs', () => {
  it.each([
    ['*', 'a.js', true],
    ['*', 'src/deep/a.js', true],
    ['*.py', 'tool/run.py', true],
    ['*.py', 'run.pyc', false],
    ['*.{js,ts}', 'src/a.ts', true],
    ['*.{js,ts}', 'src/a.tsx', false],
    ['{package.json,.travis.yml}', 'package.json', true],
    ['Makefile', 'Makefile', true],
    ['Makefile', 'sub/Makefile', true],
    ['Makefile', 'Makefile.am', false],
    ['lib/**.js', 'lib/a/b.js', true],
    ['lib/**.js', 'src/lib/a.js', false],
    ['/src/*.js', 'src/a.js', true],
    ['/src/*.js', 'src/x/a.js', false],
    ['src/**/test.js', 'src/test.js', true],
    ['file?.txt', 'file1.txt', true],
    ['file?.txt', 'file12.txt', false],
    ['[abc].md', 'b.md', true],
    ['[!abc].md', 'b.md', false],
    ['v{1..3}.txt', 'v2.txt', true],
    ['v{1..3}.txt', 'v4.txt', false],
    ['{a}.txt', '{a}.txt', true],
    ['a\\*.txt', 'a*.txt', true],
    ['a\\*.txt', 'ab.txt', false],
  ])('%s matches %s: %s', (glob, path, expected) => {
    expect(globMatches(glob, path)).toBe(expected);
  });
});

describe('resolveProperties', () => {
  const root = parseEditorConfig('root = true\n[*]\nindent_style = space\nindent_size = 2\n[*.py]\nindent_size = 4\n[Makefile]\nindent_style = tab');
  const sub = parseEditorConfig('[*.js]\nindent_size = 8\ntrim_trailing_whitespace = true\n[*.md]\nindent_size = unset');

  it('applies later sections and nearer files over earlier ones', () => {
    const files = [
      { dir: 'web', config: sub },
      { dir: '', config: root },
    ];
    expect(resolveProperties(files, 'web/a.js')).toEqual({ indent_style: 'space', indent_size: '8', trim_trailing_whitespace: 'true' });
    expect(resolveProperties(files, 'tool.py')).toEqual({ indent_style: 'space', indent_size: '4' });
    expect(resolveProperties(files, 'Makefile')).toEqual({ indent_style: 'tab', indent_size: '2' });
    expect(resolveProperties(files, 'web/a.md')).toEqual({ indent_style: 'space' });
    // The web/.editorconfig globs are relative to web/, and don't apply outside it.
    expect(resolveProperties(files, 'a.js')).toEqual({ indent_style: 'space', indent_size: '2' });
  });
});

describe('toFileFormatting', () => {
  it('turns properties into indentation and save rules', () => {
    expect(toFileFormatting({ indent_style: 'space', indent_size: '4', trim_trailing_whitespace: 'true', insert_final_newline: 'FALSE' })).toEqual({
      indent: { unit: 'space', size: 4, tabWidth: 4 },
      trimTrailingWhitespace: true,
      insertFinalNewline: false,
    });
  });

  it('works out tab sizes the usual way', () => {
    expect(toFileFormatting({ indent_style: 'tab' })).toEqual({ indent: { unit: 'tab', size: 4, tabWidth: 4 } });
    expect(toFileFormatting({ indent_style: 'tab', tab_width: '8' })).toEqual({ indent: { unit: 'tab', size: 8, tabWidth: 8 } });
    expect(toFileFormatting({ indent_style: 'space', indent_size: 'tab', tab_width: '3' })).toEqual({ indent: { unit: 'space', size: 3, tabWidth: 3 } });
    expect(toFileFormatting({ indent_size: '2', tab_width: '8' })).toEqual({ indent: { unit: 'space', size: 2, tabWidth: 8 } });
  });

  it('ignores values it does not understand', () => {
    expect(toFileFormatting({ indent_style: 'wide', indent_size: 'big', trim_trailing_whitespace: 'yes' })).toEqual({});
  });
});

describe('loadFileFormatting', () => {
  it('walks up from the file and stops at root = true', async () => {
    const disk: Record<string, string> = {
      '.editorconfig': '[*]\nindent_size = 8',
      'app/.editorconfig': 'root = true\n[*]\nindent_style = space\nindent_size = 2',
      'app/src/.editorconfig': '[*.ts]\ninsert_final_newline = true',
    };
    const reads: string[] = [];
    const read = async (p: string) => {
      reads.push(p);
      return disk[p] ?? null;
    };
    expect(await loadFileFormatting(read, 'app/src/lib/a.ts')).toEqual({ indent: { unit: 'space', size: 2, tabWidth: 2 }, insertFinalNewline: true });
    expect(reads).toEqual(['app/src/lib/.editorconfig', 'app/src/.editorconfig', 'app/.editorconfig']);
  });

  it('is empty without any .editorconfig', async () => {
    expect(await loadFileFormatting(async () => null, 'a/b.js')).toEqual({});
  });
});
