import { contrastRatio } from './contrast';
import { editorThemes } from './editor';
import { terminalThemes } from './terminal';
import { ColorScheme, highContrast, palette } from './tokens';

const AA = 4.5;
const schemes: ColorScheme[] = ['dark', 'light'];

describe.each(schemes)('%s theme', (scheme) => {
  const c = palette[scheme];

  it.each(['foreground', 'mutedForeground', 'brand', 'success', 'warning', 'destructive'] as const)(
    '%s text passes AA on background and card',
    (key) => {
      expect(contrastRatio(c[key], c.background)).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(c[key], c.card)).toBeGreaterThanOrEqual(AA);
    },
  );

  it('brandForeground is readable on brand, in both contrast modes', () => {
    expect(contrastRatio(c.brandForeground, c.brand)).toBeGreaterThanOrEqual(AA);
    const h = highContrast[scheme];
    expect(contrastRatio(h.brandForeground, h.brand)).toBeGreaterThanOrEqual(7);
  });

  it('ANSI colors pass AA on the terminal background', () => {
    const t = terminalThemes[scheme];
    const { background, foreground, cursor, cursorAccent, selectionBackground, ...ansi } = t;
    // ANSI black on a dark terminal is a background shade by convention.
    const text = Object.entries(ansi).filter(([k]) => !(scheme === 'dark' && k === 'black'));
    for (const [name, color] of text) {
      expect([name, contrastRatio(color, background) >= AA]).toEqual([name, true]);
    }
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA);
  });

  it('syntax colors pass AA on the editor background and active line', () => {
    const e = editorThemes[scheme];
    for (const [name, color] of Object.entries(e.syntax)) {
      expect([name, contrastRatio(color, e.background) >= AA]).toEqual([name, true]);
      expect([name, contrastRatio(color, e.activeLine) >= AA]).toEqual([name, true]);
    }
    expect(contrastRatio(e.gutterForeground, e.background)).toBeGreaterThanOrEqual(AA);
  });
});
