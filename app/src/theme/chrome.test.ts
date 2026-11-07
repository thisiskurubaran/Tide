import { colorThemes } from '../extensions/themes/catalog';
import { chromeColors, ensureContrast, mix } from './chrome';
import { contrastRatio } from './contrast';

const AA = 4.5;

describe.each(colorThemes.map((t) => [t.name, t] as const))('%s chrome', (_, theme) => {
  const c = chromeColors(theme);

  it('keeps the theme background and accent hue', () => {
    expect(c.background).toBe(theme.editor.background);
    expect(c.logoAccent).toBe(theme.accent);
  });

  it.each(['foreground', 'mutedForeground', 'brand', 'success', 'warning', 'destructive'] as const)('%s text passes AA on background, card and secondary', (key) => {
    for (const bg of [c.background, c.card, c.secondary]) expect(contrastRatio(c[key], bg)).toBeGreaterThanOrEqual(AA);
  });

  it('keeps text on the brand color readable', () => {
    expect(contrastRatio(c.brandForeground, c.brand)).toBeGreaterThanOrEqual(AA);
  });

  it('shows borders against cards', () => {
    expect(contrastRatio(c.border, c.card)).toBeGreaterThan(1.1);
  });
});

it('uses each theme\'s own accent, only nudged where it needs more contrast', () => {
  const brand = (id: string) => chromeColors(colorThemes.find((t) => t.id === id)!).brand;
  expect(brand('one-dark')).toBe('#61afef');
  expect(brand('github-light')).toBe('#0969da');
  for (const t of colorThemes) expect([t.id, contrastRatio(chromeColors(t).brand, t.accent) < 1.8]).toEqual([t.id, true]);
});

it('mixes and nudges colors', () => {
  expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  expect(ensureContrast('#ffffff', ['#000000'])).toBe('#ffffff');
  expect(contrastRatio(ensureContrast('#777777', ['#ffffff']), '#ffffff')).toBeGreaterThanOrEqual(AA);
});
