import { Text } from '@codemirror/state';

import { findConflicts, minimalChange, resolveConflict } from './features';

const doc = (s: string) => Text.of(s.split('\n'));
const apply = (s: string, c: { from: number; to: number; insert: string }) => s.slice(0, c.from) + c.insert + s.slice(c.to);

describe('merge conflicts', () => {
  const text = ['a', '<<<<<<< HEAD', 'mine', '=======', 'theirs', 'theirs 2', '>>>>>>> branch', 'z'].join('\n');

  it('finds conflict markers', () => {
    expect(findConflicts(doc(text))).toEqual([{ start: 2, middle: 4, end: 7, base: null }]);
  });

  it.each([
    ['current', 'a\nmine\nz'],
    ['incoming', 'a\ntheirs\ntheirs 2\nz'],
    ['both', 'a\nmine\ntheirs\ntheirs 2\nz'],
  ] as const)('accepts %s', (choice, expected) => {
    const d = doc(text);
    expect(apply(text, resolveConflict(d, findConflicts(d)[0], choice))).toBe(expected);
  });

  it('skips the base section of diff3 conflicts', () => {
    const t = ['<<<<<<< ours', 'x', '||||||| base', 'o', '=======', 'y', '>>>>>>> theirs'].join('\n');
    const d = doc(t);
    const [c] = findConflicts(d);
    expect(c.base).toBe(3);
    expect(apply(t, resolveConflict(d, c, 'both'))).toBe('x\ny');
  });

  it('ignores an unfinished conflict', () => {
    expect(findConflicts(doc('<<<<<<< a\nx\n=======\ny'))).toEqual([]);
  });
});

describe('minimalChange', () => {
  it('replaces only the part that differs', () => {
    expect(minimalChange('const a=1;\nfoo()', 'const a = 1;\nfoo()')).toEqual({ from: 7, to: 8, insert: ' = ' });
    expect(minimalChange('same', 'same')).toBeNull();
    const c = minimalChange('abcabc', 'abc')!;
    expect(apply('abcabc', c)).toBe('abc');
  });
});
