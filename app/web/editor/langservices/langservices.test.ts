import { cssView, embeddedRegions, isJsonc, lineIndex, lspSnippet, markdownText, rankBoosts, samePresentation, serviceKind, toCompletion, toDiagnostics, toHover } from './adapters';
import { cssService } from './css';
import { htmlService } from './html';
import { jsonService } from './json';

describe('adapters', () => {
  it('maps editor languages to services', () => {
    expect(serviceKind('scss')).toBe('scss');
    expect(serviceKind('json')).toBe('json');
    expect(serviceKind('javascript')).toBeNull();
    expect(serviceKind('plain')).toBeNull();
  });

  it('knows which JSON files allow comments', () => {
    expect(isJsonc('tsconfig.json')).toBe(true);
    expect(isJsonc('app/tsconfig.build.json')).toBe(true);
    expect(isJsonc('.eslintrc')).toBe(true);
    expect(isJsonc('package.json')).toBe(false);
  });

  it('converts LSP snippets to CodeMirror templates', () => {
    expect(lspSnippet('color: $0;')).toBe('color: ${0};');
    expect(lspSnippet('type="$1"')).toBe('type="${1}"');
    expect(lspSnippet('"name": ${1:value}')).toBe('"name": ${1:value}');
    expect(lspSnippet('${1|a,b|}')).toBe('${1:a}');
    expect(lspSnippet('"scripts": {$1}')).toBe('"scripts": \\{${1}\\}');
    expect(lspSnippet('cost \\$5')).toBe('cost $5');
  });

  it('turns markdown into plain hover text', () => {
    expect(markdownText('Sets the color.\n\nSyntax: &lt;color&gt;\n\n[MDN Reference](https://x)')).toBe('Sets the color.\n\nSyntax: <color>');
    expect(markdownText('![Baseline icon](data:x) _Widely available_')).toBe('Widely available');
    expect(markdownText('Use `a` and [b](u)')).toBe('Use a and b');
  });

  it('converts completions with their edit range', () => {
    const text = 'a { col }';
    const index = lineIndex(text);
    const c = toCompletion(
      { label: 'color', kind: 10, insertTextFormat: 2, textEdit: { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } }, newText: 'color: $0;' }, command: { title: '', command: 'editor.action.triggerSuggest' } },
      index,
      7,
      4,
    );
    expect(c).toMatchObject({ label: 'color', type: 'property', from: 4, to: 7, insert: 'color: ${0};', snippet: true, retrigger: true });
    const f = toCompletion({ label: 'name', filterText: '"name"' }, index, 7, 5);
    expect(f).toMatchObject({ label: '"name"', displayLabel: 'name', from: 5, to: 7, insert: 'name', snippet: false });
  });

  it('keeps the service order through boosts', () => {
    const b = rankBoosts([{ label: 'b', sortText: 'b' }, { label: 'a', sortText: 'a' }, { label: 'c', sortText: 'c' }]);
    expect(b[1]).toBeGreaterThan(b[0]);
    expect(b[0]).toBeGreaterThan(b[2]);
  });

  it('converts diagnostics and hovers to offsets', () => {
    const index = lineIndex('ab\ncd');
    const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } };
    expect(toDiagnostics([{ range, severity: 2, message: 'm' }, { range, message: { value: 'x' } }], index, 'css')).toEqual([
      { from: 3, to: 5, severity: 'warning', message: 'm', source: 'css' },
      { from: 3, to: 5, severity: 'error', message: 'x', source: 'css' },
    ]);
    expect(toHover({ contents: { kind: 'markdown', value: '```css\np\n```\nDocs' }, range }, index, 3)).toEqual({ code: 'p', text: 'Docs', from: 3, to: 5 });
  });

  it('finds <style> and <script> bodies and blanks the rest', () => {
    const html = '<p>\n<style>a{}</style><script type="text/template">x</script><script>y</script>';
    const regions = embeddedRegions(html);
    expect(regions.map((r) => [r.kind, html.slice(r.from, r.to)])).toEqual([
      ['css', 'a{}'],
      ['js', 'y'],
    ]);
    const view = cssView(html, regions);
    expect(view.length).toBe(html.length);
    expect(view.trim()).toBe('a{}');
    expect(view.indexOf('\n')).toBe(3);
  });

  it('keeps the color notation when picking', () => {
    expect(samePresentation('rgb(1, 2, 3)', ['rgb(0, 255, 0)', '#00ff00', 'hsl(120, 100%, 50%)'])).toBe('rgb(0, 255, 0)');
    expect(samePresentation('#abc', ['rgb(0, 255, 0)', '#00ff00'])).toBe('#00ff00');
    expect(samePresentation('red', ['rgb(0, 255, 0)', '#00ff00'])).toBe('#00ff00');
  });
});

describe('services', () => {
  it('validates and completes CSS', async () => {
    const css = cssService('css');
    const text = 'a { colr: red; color: #fff; }';
    const diags = await css.validate('a.css', text);
    expect(diags).toEqual([expect.objectContaining({ from: 4, to: 8, severity: 'warning', source: 'css' })]);
    expect(css.colors('a.css', text).map((c) => text.slice(c.from, c.to))).toEqual(['red', '#fff']);
    const items = await css.complete('a.css', 'a { disp }', 8);
    expect(items?.some((i) => i.label === 'display')).toBe(true);
  });

  it('accepts SCSS syntax', async () => {
    expect(await cssService('scss').validate('a.scss', '$c: red;\n.a { &:hover { color: $c; } }')).toEqual([]);
  });

  it('uses the CSS service inside <style> only', async () => {
    const text = '<style>p { colr: 1 }</style>\n<script>let a</script>';
    expect((await htmlService.validate('i.html', text)).map((d) => text.slice(d.from, d.to))).toEqual(['colr']);
    expect(await htmlService.complete('i.html', text, text.indexOf('let a') + 5)).toBeNull();
  });

  it('checks tide.json against its schema', async () => {
    const text = '{ "runtime": "rust", "entry": "a.js" }';
    const diags = await jsonService.validate('tide.json', text);
    expect(diags.map((d) => text.slice(d.from, d.to))).toEqual(['"rust"']);
    const hover = await jsonService.hover('tide.json', text, 5);
    expect(hover?.text).toMatch(/runs the entry/);
  });

  it('allows comments in tsconfig.json but not package.json', async () => {
    const text = '{\n  // hi\n  "compilerOptions": {},\n}';
    expect(await jsonService.validate('tsconfig.json', text)).toEqual([]);
    expect((await jsonService.validate('package.json', text)).length).toBeGreaterThan(0);
  });
});
