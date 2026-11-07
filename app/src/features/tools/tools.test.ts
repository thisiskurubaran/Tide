import {
  base64Decode,
  base64Encode,
  csvToJson,
  decodeJwt,
  formatJson,
  hashes,
  jsonToYaml,
  minifyJson,
  regexLiteral,
  testRegex,
  timestamp,
  urlDecode,
  urlEncode,
  uuid,
  yamlToJson,
} from './tools';

describe('developer toolbox', () => {
  it('formats JSON and points at errors', () => {
    expect(formatJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(minifyJson('{ "a" : 1 }')).toBe('{"a":1}');
    expect(() => formatJson('{\n"a": }')).toThrow(/Not valid JSON/);
  });

  it('converts YAML and CSV', () => {
    expect(JSON.parse(yamlToJson('name: Tide\ntags: [a, b]\n'))).toEqual({ name: 'Tide', tags: ['a', 'b'] });
    expect(jsonToYaml('{"a":1,"b":[true]}')).toBe('a: 1\nb:\n  - true\n');
    expect(() => yamlToJson('a: [')).toThrow(/Not valid YAML/);
    expect(JSON.parse(csvToJson('name,note\r\nAda,"says ""hi"", twice"\nGrace,\n'))).toEqual([
      { name: 'Ada', note: 'says "hi", twice' },
      { name: 'Grace', note: '' },
    ]);
  });

  it('encodes and decodes Base64 and URLs, including Unicode', () => {
    expect(base64Encode('héllo ✓')).toBe('aMOpbGxvIOKckw==');
    expect(base64Decode('aMOpbGxvIOKckw')).toBe('héllo ✓');
    expect(() => base64Decode('not base64!')).toThrow('characters');
    expect(urlEncode('a b&c=ü')).toBe('a%20b%26c%3D%C3%BC');
    expect(urlDecode('a+b%26c')).toBe('a b&c');
    expect(() => urlDecode('%zz')).toThrow('two hex digits');
  });

  it('decodes JWTs and reads their dates', () => {
    const jwt = `${base64Encode('{"alg":"HS256"}')}.${base64Encode('{"sub":"1","exp":1700000000}').replace(/=+$/, '')}.sig`;
    const d = decodeJwt(`Bearer ${jwt}`, 1800000000000);
    expect(d.header).toEqual({ alg: 'HS256' });
    expect(d.payload).toEqual({ sub: '1', exp: 1700000000 });
    expect(d.notes).toContain('Expires: 2023-11-14T22:13:20.000Z');
    expect(d.notes).toContain('This token has expired.');
    expect(() => decodeJwt('a.b')).toThrow('three parts');
  });

  it('hashes, makes UUIDs and reads timestamps', () => {
    expect(hashes('abc').map((h) => h.value.slice(0, 8))).toEqual(['90015098', 'a9993e36', 'ba7816bf', 'ddaf35a1']);
    expect(uuid(() => new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(timestamp('1700000000')[2].value).toBe('2023-11-14T22:13:20.000Z');
    expect(timestamp('1700000000000')[0].value).toBe('1700000000');
    expect(timestamp('2024-02-29T12:00:00Z')[0].value).toBe('1709208000');
    expect(() => timestamp('soon')).toThrow('Not a date');
  });

  it('tests regular expressions with groups', () => {
    const m = testRegex('(?<user>\\w+)@(\\w+)\\.com', 'i', 'ada@x.com, GRACE@y.COM');
    expect(m.map((x) => [x.index, x.text, x.groups[1], x.named.user])).toEqual([
      [0, 'ada@x.com', 'x', 'ada'],
      [11, 'GRACE@y.COM', 'y', 'GRACE'],
    ]);
    expect(testRegex('', 'g', 'x')).toEqual([]);
    expect(() => testRegex('(', '', 'x')).toThrow(/Unterminated group/);
    expect(regexLiteral('a/b\\/c', 'gi')).toBe('/a\\/b\\/c/gi');
  });
});
