import { shortcutFor } from './shortcuts';

const key = (k: string, mods: { meta?: boolean; shift?: boolean; alt?: boolean; code?: string } = {}) =>
  shortcutFor({ key: k, code: mods.code, metaKey: mods.meta ?? false, shiftKey: mods.shift ?? false, altKey: mods.alt ?? false });

describe('shortcutFor', () => {
  it('maps Cmd shortcuts', () => {
    expect(key('p', { meta: true })).toBe('quick-open');
    expect(key('P', { meta: true, shift: true })).toBe('palette');
    expect(key('F', { meta: true, shift: true })).toBe('search');
    expect(key('l', { meta: true })).toBe('goto-line');
    expect(key('j', { meta: true })).toBe('toggle-terminal');
    expect(key('s', { meta: true })).toBe('save');
    expect(key('w', { meta: true })).toBe('close-tab');
    expect(key('b', { meta: true })).toBe('files');
    expect(key('r', { meta: true })).toBe('run');
    expect(key(',', { meta: true })).toBe('settings');
  });

  it('maps tab switching by number and by physical bracket key', () => {
    expect(key('1', { meta: true })).toBe('tab-1');
    expect(key('9', { meta: true })).toBe('tab-9');
    expect(key('0', { meta: true })).toBeNull();
    expect(key('{', { meta: true, shift: true, code: 'BracketLeft' })).toBe('prev-tab');
    expect(key('}', { meta: true, shift: true, code: 'BracketRight' })).toBe('next-tab');
    expect(key('?', { meta: true, shift: true, code: 'Slash' })).toBe('keyboard-shortcuts');
  });

  it('leaves everything else to the editor or terminal', () => {
    expect(key('p')).toBeNull();
    expect(key('f', { meta: true })).toBeNull();
    expect(key('/', { meta: true })).toBeNull();
    expect(key('d', { meta: true })).toBeNull();
    // Cmd-] without Shift indents in the editor.
    expect(key(']', { meta: true, code: 'BracketRight' })).toBeNull();
    expect(key('l', { meta: true, alt: true })).toBeNull();
  });

  it('maps Shift+Option+F to format by physical key', () => {
    expect(shortcutFor({ key: 'Ï', code: 'KeyF', metaKey: false, shiftKey: true, altKey: true })).toBe('format');
    expect(shortcutFor({ key: 'ƒ', code: 'KeyF', metaKey: false, shiftKey: false, altKey: true })).toBeNull();
  });
});
