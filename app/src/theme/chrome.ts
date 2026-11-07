// The app's chrome colors derived from a Themes & Icons color theme, so the
// file tree, sheets and buttons sit in the same world as the editor.
// Plain data in, plain data out: no React, so it's easy to test.
import type { ColorTheme } from '../extensions/themes/catalog';
import { contrastRatio, luminance } from './contrast';
import type { Colors } from './tokens';

const AA = 4.5;

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

// `amount` of `b` over `a`, in sRGB like CSS color-mix.
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * amount));
}

// Nudges `color` toward white or black (whichever moves away from the
// backgrounds) until it reaches `min` against all of them. Most theme colors
// already pass and come back unchanged.
export function ensureContrast(color: string, backgrounds: string[], min = AA): string {
  const passes = (c: string) => backgrounds.every((bg) => contrastRatio(c, bg) >= min);
  if (passes(color)) return color;
  const target = luminance(backgrounds[0]) < 0.18 ? '#ffffff' : '#000000';
  for (let t = 0.05; t < 1; t += 0.05) {
    const next = mix(color, target, t);
    if (passes(next)) return next;
  }
  return target;
}

export function chromeColors(theme: ColorTheme): Colors {
  const e = theme.editor;
  const t = theme.terminal;
  const bg = e.background;
  const card = e.activeLine;
  // A step past the card, toward the text color, for pressed rows and fills.
  const secondary = mix(card, e.foreground, theme.dark ? 0.06 : 0.04);
  const text = (c: string) => ensureContrast(c, [bg, card, secondary]);
  // Some themes (Solarized) use the active line color as their border, which
  // would vanish against cards; fall back to a mix that shows.
  const border = contrastRatio(e.gutterBorder, card) >= 1.2 ? e.gutterBorder : mix(card, e.foreground, 0.16);
  const brand = text(theme.accent);
  const soft = (c: string) => mix(bg, c, theme.dark ? 0.16 : 0.12);
  return {
    background: bg,
    foreground: text(e.foreground),
    card,
    secondary,
    // Comments are usually too faint for labels; pull them toward the text.
    mutedForeground: text(mix(e.syntax.comment, e.foreground, 0.35)),
    border,
    brand,
    // brand passes AA against bg, so bg passes AA on brand too.
    brandForeground: bg,
    brandSoft: soft(brand),
    success: text(t.green),
    successSoft: soft(t.green),
    warning: text(t.yellow),
    warningSoft: soft(t.yellow),
    destructive: text(t.red),
    destructiveSoft: soft(t.red),
    logoAccent: theme.accent,
  };
}

const cache = new Map<string, Colors>();
export const chromeColorsCached = (theme: ColorTheme) => {
  let c = cache.get(theme.id);
  if (!c) cache.set(theme.id, (c = chromeColors(theme)));
  return c;
};
