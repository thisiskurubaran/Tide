import { parseCurl, shellWords, toCurl, toHttpText } from './curl';
import { parseHttpFile, toWire } from './http';

describe('cURL', () => {
  it('splits words like a shell', () => {
    expect(shellWords(`curl 'a b' "c \\"d\\"" e\\ f $'g\\nh' \\\n  -s`)).toEqual(['curl', 'a b', 'c "d"', 'e f', 'g\nh', '-s']);
  });

  it('reads a browser "Copy as cURL" command', () => {
    const req = parseCurl(`curl 'https://api.example.com/items?page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc' \\
  --data-raw '{"name":"Ada"}' \\
  --compressed`);
    expect(req).toEqual({
      method: 'POST',
      url: 'https://api.example.com/items?page=2',
      headers: [
        ['accept', 'application/json'],
        ['authorization', 'Bearer abc'],
        ['Content-Type', 'application/x-www-form-urlencoded'],
      ],
      body: '{"name":"Ada"}',
    });
  });

  it('handles -X, --json, -u, -G and joined short options', () => {
    expect(parseCurl('curl -XDELETE https://x.dev/a/1').method).toBe('DELETE');
    const json = parseCurl(`curl --json '{"a":1}' https://x.dev`);
    expect(json.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ]);
    expect(parseCurl('curl -u ada:secret x.dev').headers).toEqual([['Authorization', 'Basic YWRhOnNlY3JldA==']]);
    expect(parseCurl('curl -G https://x.dev/s -d q=tide --data-urlencode "lang=c++"')).toMatchObject({ method: 'GET', url: 'https://x.dev/s?q=tide&lang=c%2B%2B', body: '' });
    expect(parseCurl('$ curl -o out.txt -L x.dev/file').url).toBe('http://x.dev/file');
  });

  it('explains what it cannot read', () => {
    expect(() => parseCurl('wget x.dev')).toThrow('doesn’t start with curl');
    expect(() => parseCurl('curl -s')).toThrow('no URL');
    expect(() => parseCurl("curl 'x.dev")).toThrow('never closed');
    expect(() => parseCurl('curl -F file=@a.png x.dev')).toThrow('-F');
  });

  it('writes a request as a curl command that reads back the same', () => {
    const req = { method: 'PUT', url: 'https://x.dev/a', headers: [['Content-Type', 'application/json']] as [string, string][], body: `{"it's":1}` };
    const command = toCurl(req);
    expect(command).toBe(`curl \\\n  -X PUT \\\n  'https://x.dev/a' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"it'\\''s":1}'`);
    expect(parseCurl(command)).toEqual(req);
    expect(toCurl({ method: 'GET', url: 'https://x.dev', headers: [], body: '' })).toBe(`curl \\\n  'https://x.dev'`);
  });

  it('turns a parsed command into .http text that parses back', () => {
    const text = toHttpText(parseCurl(`curl --json '{"a":1}' https://x.dev/items`), 'Add an item');
    expect(text).toBe('### Add an item\nPOST https://x.dev/items\nContent-Type: application/json\nAccept: application/json\n\n{\n  "a": 1\n}\n');
    const [req] = parseHttpFile(text).requests;
    expect(req).toMatchObject({ name: 'Add an item', method: 'POST', url: 'https://x.dev/items', body: '{\n  "a": 1\n}' });
  });
});

describe('GraphQL', () => {
  it('sends a GRAPHQL request as a JSON POST with variables', () => {
    const [req] = parseHttpFile(`GRAPHQL https://x.dev/graphql
Authorization: Bearer t

query Country($code: ID!) {
  country(code: $code) {
    name
  }
}

{ "code": "NZ" }
`).requests;
    const wire = toWire(req);
    expect(wire.method).toBe('POST');
    expect(wire.headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer t'],
    ]);
    expect(JSON.parse(wire.body)).toEqual({
      query: 'query Country($code: ID!) {\n  country(code: $code) {\n    name\n  }\n}',
      operationName: 'Country',
      variables: { code: 'NZ' },
    });
  });

  it('reads the REST Client header form, without variables', () => {
    const [req] = parseHttpFile('POST https://x.dev/graphql\nX-REQUEST-TYPE: GraphQL\n\n{ viewer { login } }\n').requests;
    const wire = toWire(req);
    expect(wire.headers).toEqual([['Content-Type', 'application/json']]);
    expect(JSON.parse(wire.body)).toEqual({ query: '{ viewer { login } }' });
  });

  it('leaves other requests alone and rejects bad variables', () => {
    const [plain] = parseHttpFile('GET https://x.dev\n').requests;
    expect(toWire(plain)).toBe(plain);
    const [bad] = parseHttpFile('GRAPHQL https://x.dev\n\nquery { a }\n\n{ nope }\n').requests;
    expect(() => toWire(bad)).toThrow('variables');
  });
});
