// "Share selection as image": the code drawn on a card in the editor's
// theme, with the file name, optional line numbers and a small Tide mark,
// as a PNG. Drawn on a canvas token by token (colors from the same tag
// styles the editor uses), so it works offline and needs no HTML-to-image
// library.
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { highlightTree, tagHighlighter } from '@lezer/highlight';

import type { EditorTheme } from '../../src/theme/editor';
import { highlightSpecs } from './theme';

export const MAX_IMAGE_LINES = 120;
// Longer lines are cut with an ellipsis, so the card stays a sensible width.
export const MAX_IMAGE_COLUMNS = 120;

export type Token = { text: string; color: string; italic?: boolean; bold?: boolean };

export type ImageRange = { from: number; to: number; firstLine: number; lineCount: number };

// The selection, or the whole file; an error message when it's too long.
export function imageRange(state: EditorState): ImageRange | { error: string } {
  const r = state.selection.main;
  const { doc } = state;
  let from: number;
  let to: number;
  if (!r.empty) {
    // Whole lines, so the line numbers line up. A selection ending at the
    // start of a line doesn't take that line.
    const first = doc.lineAt(r.from).number;
    let last = doc.lineAt(r.to).number;
    if (last > first && doc.line(last).from === r.to) last--;
    from = doc.line(first).from;
    to = doc.line(last).to;
  } else {
    if (!doc.toString().trim()) return { error: 'There is no code to share in this file.' };
    from = 0;
    to = doc.length;
    // Blank lines at the end don't count.
    while (to > 0 && doc.sliceString(to - 1, to) === '\n') to--;
  }
  const firstLine = doc.lineAt(from).number;
  const lineCount = doc.lineAt(to).number - firstLine + 1;
  if (lineCount > MAX_IMAGE_LINES) {
    return {
      error: r.empty
        ? `This file has ${lineCount} lines. Select up to ${MAX_IMAGE_LINES} lines to share as an image.`
        : `That's ${lineCount} lines. Select up to ${MAX_IMAGE_LINES} lines to share as an image.`,
    };
  }
  return { from, to, firstLine, lineCount };
}

const expandTabs = (text: string, tabSize: number, startCol: number) => {
  let out = '';
  let col = startCol;
  for (const ch of text) {
    if (ch === '\t') {
      const n = tabSize - (col % tabSize);
      out += ' '.repeat(n);
      col += n;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
};

// Lines of colored tokens for [from, to), tabs expanded, long lines cut.
export function highlightedLines(state: EditorState, range: { from: number; to: number }, theme: EditorTheme, tabSize = state.tabSize): Token[][] {
  const specs = highlightSpecs(theme);
  // The class is the style itself: "color|i|b".
  const highlighter = tagHighlighter(specs.map((sp) => ({ tag: sp.tag, class: `${sp.color}|${sp.fontStyle === 'italic' ? 'i' : ''}|${sp.fontWeight ? 'b' : ''}` })));
  const styles: { from: number; to: number; cls: string }[] = [];
  const tree = ensureSyntaxTree(state, range.to, 1000);
  if (tree) highlightTree(tree, highlighter, (from, to, cls) => styles.push({ from, to, cls: cls.split(' ')[0] }), range.from, range.to);

  const tokens: Token[] = [];
  let pos = range.from;
  const plain = (to: number) => {
    if (to > pos) tokens.push({ text: state.sliceDoc(pos, to), color: theme.foreground });
  };
  for (const st of styles) {
    const from = Math.max(st.from, range.from);
    const to = Math.min(st.to, range.to);
    if (to <= from || from < pos) continue;
    plain(from);
    const [color, i, b] = st.cls.split('|');
    tokens.push({ text: state.sliceDoc(from, to), color, ...(i ? { italic: true } : {}), ...(b ? { bold: true } : {}) });
    pos = to;
  }
  plain(range.to);

  // Split on newlines into lines.
  const lines: Token[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.text.split('\n');
    parts.forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...tok, text: part });
    });
  }
  return lines.map((line) => {
    const out: Token[] = [];
    let col = 0;
    for (const tok of line) {
      if (col >= MAX_IMAGE_COLUMNS) break;
      let text = expandTabs(tok.text, tabSize, col);
      if (col + text.length > MAX_IMAGE_COLUMNS) text = `${text.slice(0, MAX_IMAGE_COLUMNS - col - 1)}…`;
      col += text.length;
      out.push({ ...tok, text });
    }
    return out;
  });
}

export interface CardLayout {
  width: number;
  height: number;
  // The card inside the frame.
  card: { x: number; y: number; width: number; height: number };
  titleHeight: number;
  gutterWidth: number;
  codeX: number;
  codeY: number;
  lineHeight: number;
}

export const CARD = { frame: 28, padding: 18, titleHeight: 34, lineHeight: 1.55, minCodeWidth: 320, brandHeight: 22 };

// Sizes in CSS pixels, before the device scale.
export function cardLayout(lines: Token[][], opts: { charWidth: number; fontSize: number; lineNumbers: boolean; firstLine: number }): CardLayout {
  const lineHeight = Math.round(opts.fontSize * CARD.lineHeight);
  const cols = Math.max(0, ...lines.map((l) => l.reduce((n, t) => n + t.text.length, 0)));
  const digits = String(opts.firstLine + lines.length - 1).length;
  const gutterWidth = opts.lineNumbers ? Math.ceil(digits * opts.charWidth + 16) : 0;
  const codeWidth = Math.max(CARD.minCodeWidth, Math.ceil(cols * opts.charWidth));
  const cardWidth = CARD.padding * 2 + gutterWidth + codeWidth;
  const cardHeight = CARD.titleHeight + CARD.padding + lines.length * lineHeight + CARD.padding;
  const card = { x: CARD.frame, y: CARD.frame, width: cardWidth, height: cardHeight };
  return {
    width: cardWidth + CARD.frame * 2,
    height: cardHeight + CARD.frame + Math.max(CARD.frame, CARD.brandHeight + 12),
    card,
    titleHeight: CARD.titleHeight,
    gutterWidth,
    codeX: card.x + CARD.padding + gutterWidth,
    codeY: card.y + CARD.titleHeight + CARD.padding,
    lineHeight,
  };
}

// #rrggbb with an alpha; other color strings are used as they are.
const withAlpha = (hex: string, a: number) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface DrawOptions {
  theme: EditorTheme;
  title: string;
  lineNumbers: boolean;
  firstLine: number;
  // CSS font family of the code font, e.g. "'Fira Code', monospace".
  fontFamily: string;
  fontSize?: number;
  scale?: number;
}

// Draws the card and returns the PNG as base64 (no data: prefix).
export async function drawCodeCard(lines: Token[][], opts: DrawOptions): Promise<string> {
  const fontSize = opts.fontSize ?? 14;
  const scale = opts.scale ?? 2;
  const font = (t?: Token) => `${t?.italic ? 'italic ' : ''}${t?.bold ? '600 ' : ''}${fontSize}px ${opts.fontFamily}`;
  const ui = (size: number, weight = '') => `${weight ? `${weight} ` : ''}${size}px -apple-system, system-ui, sans-serif`;
  // The code font has to be loaded before the canvas can use it.
  await Promise.all([document.fonts.load(font()), document.fonts.load(font({ text: '', color: '', italic: true }))]).catch(() => undefined);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  ctx.font = font();
  const charWidth = ctx.measureText('M').width;
  const L = cardLayout(lines, { charWidth, fontSize, lineNumbers: opts.lineNumbers, firstLine: opts.firstLine });
  canvas.width = Math.ceil(L.width * scale);
  canvas.height = Math.ceil(L.height * scale);
  ctx.scale(scale, scale);
  const { theme } = opts;
  const s = theme.syntax;

  // Frame: a soft wash of the theme's keyword and function colors.
  const wash = ctx.createLinearGradient(0, 0, L.width, L.height);
  wash.addColorStop(0, withAlpha(s.keyword, 0.35));
  wash.addColorStop(1, withAlpha(s.function, 0.3));
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, L.width, L.height);

  // Card with a shadow.
  const { card } = L;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, card.x, card.y, card.width, card.height, 12);
  ctx.fillStyle = theme.background;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, card.x + 0.5, card.y + 0.5, card.width - 1, card.height - 1, 12);
  ctx.strokeStyle = withAlpha(theme.gutterBorder, 0.9);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Title bar: three dots and the file name.
  const midY = card.y + L.titleHeight / 2 + 2;
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, k) => {
    ctx.beginPath();
    ctx.arc(card.x + 18 + k * 18, midY, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  ctx.font = ui(12, '500');
  ctx.fillStyle = theme.gutterForeground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxTitle = card.width - 140;
  let title = opts.title;
  while (title.length > 4 && ctx.measureText(title).width > maxTitle) title = `…${title.slice(2)}`;
  ctx.fillText(title, card.x + card.width / 2, midY);

  // Code, one token at a time, with line numbers in the gutter.
  ctx.textBaseline = 'middle';
  lines.forEach((line, k) => {
    const y = L.codeY + k * L.lineHeight + L.lineHeight / 2;
    if (opts.lineNumbers) {
      ctx.font = font();
      ctx.textAlign = 'right';
      ctx.fillStyle = withAlpha(theme.gutterForeground, 0.8);
      ctx.fillText(String(opts.firstLine + k), L.codeX - 16, y);
    }
    ctx.textAlign = 'left';
    let col = 0;
    for (const tok of line) {
      ctx.font = font(tok);
      ctx.fillStyle = tok.color;
      ctx.fillText(tok.text, L.codeX + col * charWidth, y);
      col += tok.text.length;
    }
  });

  // A small, quiet mark under the card.
  ctx.font = ui(11, '600');
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = withAlpha(theme.foreground, 0.45);
  ctx.fillText('Tide', card.x + card.width, card.y + card.height + (L.height - card.y - card.height) / 2);

  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

// "src/app.ts" -> "app.png"
export const imageName = (path: string) => `${(path.split('/').pop() ?? 'code').replace(/\.[^.]+$/, '') || 'code'}.png`;
