import { isValidKey, parseDotenv, quoteValue, removeDotenv, setDotenv } from './dotenv';

describe('.env files', () => {
  it('reads the forms dotenv accepts', () => {
    const text = `# Database
export DB_HOST=localhost
DB_PORT = 5432
NAME="Tide App" # a comment
SINGLE='no $expansion # here'
URL=https://x.dev/?a=1#frag
INLINE=value # comment
EMPTY=
ESCAPED="line1\\nline2 \\"quoted\\""
MULTI="first
second"
not a line
DB_PORT=6543`;
    expect(parseDotenv(text)).toEqual([
      { key: 'DB_HOST', value: 'localhost' },
      { key: 'DB_PORT', value: '6543' },
      { key: 'NAME', value: 'Tide App' },
      { key: 'SINGLE', value: 'no $expansion # here' },
      { key: 'URL', value: 'https://x.dev/?a=1#frag' },
      { key: 'INLINE', value: 'value' },
      { key: 'EMPTY', value: '' },
      { key: 'ESCAPED', value: 'line1\nline2 "quoted"' },
      { key: 'MULTI', value: 'first\nsecond' },
    ]);
  });

  it('quotes only when it has to, and reads its own output back', () => {
    expect(quoteValue('abc-1.2/x:y')).toBe('abc-1.2/x:y');
    for (const v of ['two words', 'has "quotes"', 'back\\slash', 'a\nb', '# not a comment', '']) {
      expect(parseDotenv(setDotenv('', 'K', v))).toEqual([{ key: 'K', value: v }]);
    }
  });

  it('changes a value in place, keeping comments and order', () => {
    const text = '# top\nA=1\n\n# b\nB=2\n';
    expect(setDotenv(text, 'A', 'one')).toBe('# top\nA=one\n\n# b\nB=2\n');
    expect(setDotenv(text, 'C', '3')).toBe('# top\nA=1\n\n# b\nB=2\nC=3\n');
    expect(setDotenv('', 'C', '3')).toBe('C=3\n');
    expect(removeDotenv(text, 'A')).toBe('# top\n\n# b\nB=2\n');
  });

  it('checks names', () => {
    expect(isValidKey('API_KEY')).toBe(true);
    expect(isValidKey('1KEY')).toBe(false);
    expect(isValidKey('MY-KEY')).toBe(false);
  });
});
