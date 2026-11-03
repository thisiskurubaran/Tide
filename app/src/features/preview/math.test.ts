/**
 * @jest-environment node
 */
import katex from 'katex';

import { hasMath, MATH_INIT, mathAssets, renderMath } from './math';
import { markdownToHtml, notebookToHtml, previewPage } from './render';

const colors = { background: '#fff', foreground: '#000', muted: '#666', border: '#ccc', code: '#eee', link: '#00f', error: '#f00' };
const inline = (tex: string) => `<span class="math-inline">${tex}</span>`;
const display = (tex: string, tag = 'span') => `<${tag} class="math-display">${tex}</${tag}>`;

describe('math in Markdown', () => {
  it('finds inline and display math with each delimiter', () => {
    expect(markdownToHtml('Euler: $e^{i\\pi} + 1 = 0$.')).toBe(`<p>Euler: ${inline('e^{i\\pi} + 1 = 0')}.</p>\n`);
    expect(markdownToHtml('Also \\(a_1 * b_2\\) here')).toBe(`<p>Also ${inline('a_1 * b_2')} here</p>\n`);
    expect(markdownToHtml('Inline display $$x^2$$ too')).toBe(`<p>Inline display ${display('x^2')} too</p>\n`);
    expect(markdownToHtml('Text\n\n$$\n\\int_0^1 f(x)\\,dx < 1\n$$\n\nAfter')).toBe(`<p>Text</p>\n${display('\\int_0^1 f(x)\\,dx &lt; 1', 'div')}\n<p>After</p>\n`);
    expect(markdownToHtml('\\[\n\\sum_n n\n\\]')).toBe(`${display('\\sum_n n', 'div')}\n`);
  });

  it("keeps Markdown out of math and the TeX escaped", () => {
    // Underscores and asterisks would otherwise be emphasis.
    expect(markdownToHtml('$a_1 * b_2 * c_3$')).toContain(inline('a_1 * b_2 * c_3'));
    expect(markdownToHtml('$x<y$ & $"q"$')).toBe(`<p>${inline('x&lt;y')} &amp; ${inline('&quot;q&quot;')}</p>\n`);
  });

  it('ignores $ in code spans and code blocks', () => {
    const html = markdownToHtml('Run `echo $HOME and $PATH` now\n\n```sh\nexport A=$B$C\n$$ not math $$\n```\n\n    indented $x$ code\n');
    expect(hasMath(html)).toBe(false);
    expect(html).toContain('<code>echo $HOME and $PATH</code>');
    expect(html).toContain('$$ not math $$');
  });

  it('leaves currency alone', () => {
    for (const text of ['It costs $5 and $10.', 'Between $5 and $10, or $20', 'Pay $ 5 then $x $', 'Escaped \\$x\\$ stays']) {
      expect(hasMath(markdownToHtml(text))).toBe(false);
    }
    // A closing $ is not followed by a digit, nor after a space; an opening one not before a space.
    expect(markdownToHtml('$x$5')).not.toContain('math-');
    expect(markdownToHtml('$x $ and $ y')).not.toContain('math-');
    expect(markdownToHtml('The price is $5, but $y = mx + b$ is math')).toBe(`<p>The price is $5, but ${inline('y = mx + b')} is math</p>\n`);
  });

  it('gives notebook markdown cells math too', () => {
    const nb = JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['Energy $E = mc^2$'] }, { cell_type: 'code', source: 'x = "$a$"', outputs: [] }] });
    const html = notebookToHtml(nb);
    expect(html).toContain(inline('E = mc^2'));
    expect(html).toContain('x = &quot;$a$&quot;');
  });
});

describe('KaTeX on the page', () => {
  const katexAssets = { script: '/* katex */', css: '.katex{}' };

  it('is included only when the document has math', () => {
    expect(mathAssets(markdownToHtml('No math, $5 only'), katexAssets)).toBeNull();
    expect(mathAssets(markdownToHtml('$x$'), katexAssets)).toEqual({ scripts: ['/* katex */', MATH_INIT], css: expect.stringContaining('.katex{}') });
    // Before KaTeX has loaded: layout only, no scripts.
    expect(mathAssets(markdownToHtml('$x$'), null)).toEqual({ scripts: [], css: expect.not.stringContaining('.katex{}') });
    const extras = mathAssets(markdownToHtml('$x$'), katexAssets)!;
    const page = previewPage('body', colors, 14, { nonce: 'n0nce', scripts: extras.scripts }, extras.css);
    expect(page).toContain('.katex{}');
    expect(page).toContain('<script nonce="n0nce">/* katex */</script>');
    expect(page).toContain('katex.renderToString(el.textContent');
    expect(previewPage('body', colors, 14)).not.toContain('katex');
  });

  it('renders placeholders with KaTeX for pages without scripts', () => {
    const html = renderMath(markdownToHtml('Inline $x<y$ and\n\n$$\\frac{a}{b}$$\n\nbad $\\frac{$'), (tex, displayMode) => katex.renderToString(tex, { displayMode, throwOnError: false }));
    expect(html).toContain('<span class="math-inline"><span class="katex">');
    expect(html).toContain('<annotation encoding="application/x-tex">x&lt;y</annotation>');
    expect(html).toContain('<div class="math-display"><span class="katex-display">');
    // A TeX error shows as KaTeX's error text rather than failing.
    expect(html).toContain('katex-error');
  });
});
