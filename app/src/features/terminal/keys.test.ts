import { controlChar } from './keys';

const ev = (key: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean; code?: string } = {}) => ({
  key,
  code: mods.code,
  ctrlKey: mods.ctrl ?? true,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
});

describe('controlChar', () => {
  it('maps Ctrl+letter from key or code', () => {
    expect(controlChar(ev('c'))).toBe('\x03');
    expect(controlChar(ev('C'))).toBe('\x03');
    expect(controlChar(ev('\x03', { code: 'KeyC' }))).toBe('\x03');
    expect(controlChar(ev('d'))).toBe('\x04');
    expect(controlChar(ev('l'))).toBe('\x0c');
    expect(controlChar(ev('['))).toBe('\x1b');
  });

  it('ignores keys without Ctrl, and Ctrl combined with Alt or Cmd', () => {
    expect(controlChar(ev('c', { ctrl: false }))).toBeNull();
    expect(controlChar(ev('c', { alt: true }))).toBeNull();
    expect(controlChar(ev('c', { meta: true }))).toBeNull();
    expect(controlChar(ev('Enter'))).toBeNull();
  });
});
