// Math in Markdown previews: $inline$, $$display$$, \(inline\) and \[display\].
// Markdown turns math into placeholders holding the TeX; KaTeX (loaded only when
// a document has some) renders them in the preview page, or here for the PDF.
import type { TokenizerAndRendererExtension, Tokens } from 'marked';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

// The `$` that closes inline math starting at `from`: not escaped, not after a
// space and not before a digit, so "$5 and $10" stays text. The next unescaped
// `$` decides: if it can't close, this isn't math ("$5, or $x$" is math only from $x).
function closingDollar(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '$') return !isSpace(src[i - 1]) && !/\d/.test(src[i + 1] ?? '') ? i : -1;
  }
  return -1;
}

interface MathToken extends Tokens.Generic {
  type: 'math';
  raw: string;
  text: string;
  display: boolean;
}

const placeholder = (tex: string, display: boolean, block = false) => {
  const tag = block ? 'div' : 'span';
  return `<${tag} class="math-${display ? 'display' : 'inline'}">${escape(tex)}</${tag}>`;
};

// Code spans, code blocks, links and HTML are tokenized by Markdown before a
// `$` inside them is ever looked at, so they're never math.
const inlineMath: TokenizerAndRendererExtension = {
  name: 'math',
  level: 'inline',
  start(src) {
    const i = src.search(/\$|\\[([]/);
    return i < 0 ? undefined : i;
  },
  tokenizer(src): MathToken | undefined {
    if (src.startsWith('$$')) {
      const end = src.indexOf('$$', 2);
      const tex = end > 2 ? src.slice(2, end).trim() : '';
      return tex ? { type: 'math', raw: src.slice(0, end + 2), text: tex, display: true } : undefined;
    }
    if (src[0] === '$') {
      // An opening `$` isn't followed by a space.
      if (isSpace(src[1])) return undefined;
      const end = closingDollar(src, 1);
      return end > 1 ? { type: 'math', raw: src.slice(0, end + 1), text: src.slice(1, end), display: false } : undefined;
    }
    if (src.startsWith('\\(') || src.startsWith('\\[')) {
      const display = src[1] === '[';
      const end = src.indexOf(display ? '\\]' : '\\)', 2);
      const tex = end > 2 ? src.slice(2, end).trim() : '';
      return tex ? { type: 'math', raw: src.slice(0, end + 2), text: tex, display } : undefined;
    }
    return undefined;
  },
  renderer: (token) => placeholder(token.text, (token as MathToken).display),
};

// $$ or \[ starting a line, through the matching close at a line's end.
const BLOCK = [/^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/, /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/];

const blockMath: TokenizerAndRendererExtension = {
  name: 'mathBlock',
  level: 'block',
  start(src) {
    const m = /^ {0,3}(\$\$|\\\[)/m.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    for (const re of BLOCK) {
      const m = re.exec(src);
      if (m && m[1].trim()) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    }
    return undefined;
  },
  renderer: (token) => `${placeholder(token.text, true, true)}\n`,
};

export const mathExtensions = [blockMath, inlineMath];

const PLACEHOLDER = /<(span|div) class="math-(inline|display)">([^<]*)<\/\1>/g;

export const hasMath = (html: string) => /<(span|div) class="math-(inline|display)">/.test(html);

// Placeholders rendered with KaTeX's renderToString, for pages that run no
// scripts (the PDF).
export function renderMath(html: string, render: (tex: string, display: boolean) => string): string {
  return html.replace(PLACEHOLDER, (all, tag: string, kind: string, tex: string) => {
    try {
      return `<${tag} class="math-${kind}">${render(unescape(tex), kind === 'display')}</${tag}>`;
    } catch {
      return all;
    }
  });
}

// Run in the preview page after KaTeX's script, which defines `katex`.
export const MATH_INIT = `document.querySelectorAll('.math-inline,.math-display').forEach(function (el) { try { el.innerHTML = katex.renderToString(el.textContent, { displayMode: el.classList.contains('math-display'), throwOnError: false }); } catch (e) {} });`;

// Layout for the placeholders, before and after KaTeX renders them.
export const MATH_CSS = '.math-display{display:block;overflow-x:auto;overflow-y:hidden;text-align:center;margin:1em 0}.math-display .katex-display{margin:0}';

export interface KatexAssets {
  script: string;
  css: string;
}

// What a page needs for its math: nothing without math; with it, the layout,
// and KaTeX's styles and script once they're loaded.
export function mathAssets(html: string, katex: KatexAssets | null): { scripts: string[]; css: string } | null {
  if (!hasMath(html)) return null;
  return { scripts: katex ? [katex.script, MATH_INIT] : [], css: MATH_CSS + (katex?.css ?? '') };
}
