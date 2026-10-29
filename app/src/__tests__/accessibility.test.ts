/**
 * @jest-environment node
 */
/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { highContrast, palette } from '../theme/tokens';

// Every <Pressable> that does something must say what it is to screen readers.
function pressablesWithoutRole(source: string): number[] {
  const lines: number[] = [];
  for (const m of source.matchAll(/<Pressable\b/g)) {
    let i = m.index! + m[0].length;
    let depth = 0;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const attrs = source.slice(m.index!, i);
    if (/\bon(Long)?Press=/.test(attrs) && !attrs.includes('accessibilityRole')) lines.push(source.slice(0, m.index).split('\n').length);
  }
  return lines;
}

const sources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('accessibility', () => {
  it('gives every pressable a role', () => {
    const root = path.join(__dirname, '..');
    const missing = sources(root).flatMap((file) => pressablesWithoutRole(fs.readFileSync(file, 'utf8')).map((line) => `${path.relative(root, file)}:${line}`));
    expect(missing).toEqual([]);
  });

  it('keeps text readable in both themes, and very readable in high contrast', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const c = palette[scheme];
      for (const text of [c.foreground, c.mutedForeground, c.brand, c.destructive, c.success, c.warning]) expect(contrast(text, c.background)).toBeGreaterThanOrEqual(4.5);
      const h = highContrast[scheme];
      for (const text of [h.foreground, h.mutedForeground, h.brand, h.destructive, h.success, h.warning]) expect(contrast(text, h.background)).toBeGreaterThanOrEqual(7);
      expect(contrast(h.border, h.background)).toBeGreaterThanOrEqual(3);
    }
  });
});
