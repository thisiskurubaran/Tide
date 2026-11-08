// Copy as Markdown and the code image: what gets copied or drawn. The canvas
// drawing itself needs a browser; the parts here are pure.
import { EditorSelection, EditorState } from '@codemirror/state';

import { editorThemes } from '../../src/theme/editor';
import { cardLayout, highlightedLines, imageName, imageRange, MAX_IMAGE_COLUMNS, MAX_IMAGE_LINES } from './codeImage';
import { languageExtension } from './languages';
import { copiedText, fenceLanguage, markdownBlock } from './markdownCopy';

const at = (doc: string, anchor = 0, head = anchor, lang: Parameters<typeof languageExtension>[0] = 'plain') =>
  EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: languageExtension(lang) });

describe('copy as Markdown', () => {
  it('copies the selection with its lines under the file path', () => {
    const doc = 'a\nconst x = 1;\nfoo();\nz';
    const { text, lines } = copiedText(at(doc, 2, 21));
    expect(lines).toEqual({ first: 2, last: 3 });
    expect(markdownBlock('src/index.js', 'javascript', text, lines)).toBe('**src/index.js** (lines 2-3)\n\n```js\nconst x = 1;\nfoo();\n```\n');
  });

  it('copies the whole file without lines when nothing is selected, and one line as "line"', () => {
    const { text, lines } = copiedText(at('print(1)\n'));
    expect(lines).toBeNull();
    expect(markdownBlock('main.py', 'python', text, lines)).toBe('**main.py**\n\n```python\nprint(1)\n```\n');
    expect(markdownBlock('a.txt', 'plain', 'x', { first: 4, last: 4 })).toBe('**a.txt** (line 4)\n\n```\nx\n```\n');
  });

  it("doesn't count a line the selection only reaches the start of", () => {
    expect(copiedText(at('one\ntwo\nthree', 0, 8)).lines).toEqual({ first: 1, last: 2 });
  });

  it('uses a longer fence when the code has backticks', () => {
    expect(markdownBlock('README.md', 'markdown', '```js\nx\n```', null)).toBe('**README.md**\n\n````markdown\n```js\nx\n```\n````\n');
  });

  it('maps languages to common fence tags', () => {
    expect(fenceLanguage('typescript')).toBe('ts');
    expect(fenceLanguage('shell')).toBe('bash');
    expect(fenceLanguage('rust')).toBe('rust');
    expect(fenceLanguage('plain')).toBe('');
  });
});

describe('share as image', () => {
  const theme = editorThemes.dark;

  it('takes the selected lines, or the whole short file', () => {
    expect(imageRange(at('a\nb\nc\nd', 2, 5))).toEqual({ from: 2, to: 5, firstLine: 2, lineCount: 2 });
    expect(imageRange(at('a\nb\n\n'))).toEqual({ from: 0, to: 3, firstLine: 1, lineCount: 2 });
    expect(imageRange(at('  \n'))).toEqual({ error: 'There is no code to share in this file.' });
  });

  it(`refuses more than ${MAX_IMAGE_LINES} lines with a message`, () => {
    const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    expect(imageRange(at(long))).toEqual({ error: `This file has 200 lines. Select up to ${MAX_IMAGE_LINES} lines to share as an image.` });
    const r = imageRange(at(long, 0, long.indexOf('line 130')));
    expect(r).toEqual({ error: `That's 130 lines. Select up to ${MAX_IMAGE_LINES} lines to share as an image.` });
  });

  it('colors tokens with the theme and expands tabs', () => {
    const state = at('const a = "s";\n\tx', 0, 0, 'javascript');
    const lines = highlightedLines(state, { from: 0, to: state.doc.length }, theme, 4);
    expect(lines).toHaveLength(2);
    expect(lines[0].find((t) => t.text === 'const')?.color).toBe(theme.syntax.keyword);
    expect(lines[0].find((t) => t.text === '"s"')?.color).toBe(theme.syntax.string);
    expect(lines[0].map((t) => t.text).join('')).toBe('const a = "s";');
    expect(lines[1].map((t) => t.text).join('')).toBe('    x');
  });

  it('cuts very long lines', () => {
    const state = at('x'.repeat(300));
    const [line] = highlightedLines(state, { from: 0, to: 300 }, theme);
    const text = line.map((t) => t.text).join('');
    expect(text).toHaveLength(MAX_IMAGE_COLUMNS);
    expect(text.endsWith('…')).toBe(true);
  });

  it('sizes the card for the code, the gutter and the frame', () => {
    const lines = [[{ text: 'x'.repeat(50), color: '#fff' }], []];
    const withNumbers = cardLayout(lines, { charWidth: 8, fontSize: 14, lineNumbers: true, firstLine: 99 });
    const without = cardLayout(lines, { charWidth: 8, fontSize: 14, lineNumbers: false, firstLine: 99 });
    expect(withNumbers.gutterWidth).toBe(3 * 8 + 16);
    expect(without.gutterWidth).toBe(0);
    expect(withNumbers.width - without.width).toBe(40);
    expect(withNumbers.lineHeight).toBe(22);
    expect(withNumbers.height).toBeGreaterThan(2 * 22 + withNumbers.titleHeight);
  });

  it('names the image after the file', () => {
    expect(imageName('src/app.ts')).toBe('app.png');
    expect(imageName('Makefile')).toBe('Makefile.png');
  });
});
