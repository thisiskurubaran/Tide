import { fuzzyPositions, fuzzyScore } from './fuzzy';
import { highlightSegments, initialInput, parsePaletteQuery, pushRecent, range, withPrefix } from './paletteQuery';

describe('parsePaletteQuery', () => {
  it('reads the prefix and trims the rest', () => {
    expect(parsePaletteQuery('')).toEqual({ kind: 'files', text: '' });
    expect(parsePaletteQuery(' app.js ')).toEqual({ kind: 'files', text: 'app.js' });
    expect(parsePaletteQuery('>')).toEqual({ kind: 'commands', text: '' });
    expect(parsePaletteQuery('> run ')).toEqual({ kind: 'commands', text: 'run' });
    expect(parsePaletteQuery('@main')).toEqual({ kind: 'symbols', text: 'main' });
    expect(parsePaletteQuery('#todo later')).toEqual({ kind: 'text', text: 'todo later' });
  });

  it('only looks at the first character', () => {
    expect(parsePaletteQuery('a>b')).toEqual({ kind: 'files', text: 'a>b' });
    expect(parsePaletteQuery('>@x')).toEqual({ kind: 'commands', text: '@x' });
  });

  it('parses go to line and column', () => {
    expect(parsePaletteQuery(':42')).toEqual({ kind: 'line', text: '42', line: 42 });
    expect(parsePaletteQuery(': 42:7')).toEqual({ kind: 'line', text: '42:7', line: 42, column: 7 });
    expect(parsePaletteQuery(':42,7')).toEqual({ kind: 'line', text: '42,7', line: 42, column: 7 });
    expect(parsePaletteQuery(':42:0')).toEqual({ kind: 'line', text: '42:0', line: 42 });
  });

  it('has no line until a valid number is typed', () => {
    for (const q of [':', ':0', ':abc', ':4x', ':-3', ':42:']) expect(parsePaletteQuery(q)).toMatchObject({ kind: 'line', line: null });
  });
});

describe('withPrefix', () => {
  it('swaps the prefix and keeps the query', () => {
    expect(withPrefix('app', 'commands')).toBe('>app');
    expect(withPrefix('>run', 'files')).toBe('run');
    expect(withPrefix('@main', 'text')).toBe('#main');
    expect(withPrefix('> run', 'symbols')).toBe('@run');
    expect(withPrefix('', 'line')).toBe(':');
  });

  it('maps the initial mode to its prefix', () => {
    expect(initialInput('files')).toBe('');
    expect(initialInput('commands')).toBe('>');
    expect(initialInput('line')).toBe(':');
    expect(initialInput(null)).toBe('');
  });
});

describe('pushRecent', () => {
  it('puts the newest first without duplicates, capped', () => {
    let list: string[] = [];
    for (const id of ['a', 'b', 'c', 'a', 'd', 'e', 'f']) list = pushRecent(list, id);
    expect(list).toEqual(['f', 'e', 'd', 'a', 'c']);
  });
});

describe('highlighting', () => {
  it('returns the positions fuzzyScore matched', () => {
    expect(fuzzyPositions('apj', 'src/app.js')).toEqual([4, 5, 8]);
    expect(fuzzyPositions('xyz', 'src/app.js')).toBeNull();
    expect(fuzzyScore('xyz', 'src/app.js')).toBeNull();
    expect(fuzzyPositions('', 'abc')).toEqual([]);
  });

  it('splits text into matched runs', () => {
    expect(highlightSegments('app.js', [0, 1, 4])).toEqual([
      { text: 'ap', hit: true },
      { text: 'p.', hit: false },
      { text: 'j', hit: true },
      { text: 's', hit: false },
    ]);
    expect(highlightSegments('abc', null)).toEqual([{ text: 'abc', hit: false }]);
    expect(highlightSegments('', [0])).toEqual([]);
    expect(range(3, 2)).toEqual([3, 4]);
  });
});
