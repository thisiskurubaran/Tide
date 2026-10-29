import { shortcutFor } from './shortcuts';

const key = (k: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  shortcutFor({ key: k, metaKey: mods.meta ?? false, shiftKey: mods.shift ?? false, altKey: mods.alt ?? false });

describe('shortcutFor', () => {
  it('maps Cmd shortcuts', () => {
    expect(key('p', { meta: true })).toBe('quick-open');
    expect(key('P', { meta: true, shift: true })).toBe('palette');
    expect(key('F', { meta: true, shift: true })).toBe('search');
    expect(key('l', { meta: true })).toBe('goto-line');
    expect(key('j', { meta: true })).toBe('toggle-terminal');
    expect(key('s', { meta: true })).toBe('save');
  });

  it('leaves everything else to the editor or terminal', () => {
    expect(key('p')).toBeNull();
    expect(key('f', { meta: true })).toBeNull();
    expect(key('l', { meta: true, alt: true })).toBeNull();
  });

  it('maps Shift+Option+F to format by physical key', () => {
    expect(shortcutFor({ key: 'Ï', code: 'KeyF', metaKey: false, shiftKey: true, altKey: true })).toBe('format');
    expect(shortcutFor({ key: 'ƒ', code: 'KeyF', metaKey: false, shiftKey: false, altKey: true })).toBeNull();
  });
});
