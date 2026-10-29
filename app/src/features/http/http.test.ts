import { formatBody, isLocal, parseHttpFile, resolve, resolveRequest, send } from './http';

describe('.http files', () => {
  const file = `@base = http://localhost:3000
@token = abc

### List users
GET {{base}}/users
Accept: application/json
# a comment
Authorization: Bearer {{token}}

### Create a user
POST {{base}}/users HTTP/1.1
Content-Type: application/json

{
  "name": "Ada"
}

###
https://example.com/health
`;

  it('parses requests, headers, bodies and variables', () => {
    const { requests, variables } = parseHttpFile(file);
    expect(variables).toEqual({ base: 'http://localhost:3000', token: 'abc' });
    expect(requests.map((r) => [r.name, r.method, r.url, r.line])).toEqual([
      ['List users', 'GET', '{{base}}/users', 5],
      ['Create a user', 'POST', '{{base}}/users', 11],
      ['GET https://example.com/health', 'GET', 'https://example.com/health', 19],
    ]);
    expect(requests[0].headers).toEqual([
      ['Accept', 'application/json'],
      ['Authorization', 'Bearer {{token}}'],
    ]);
    expect(requests[1].body).toBe('{\n  "name": "Ada"\n}');
    const resolved = resolveRequest(requests[0], variables);
    expect(resolved.url).toBe('http://localhost:3000/users');
    expect(resolved.headers[1]).toEqual(['Authorization', 'Bearer abc']);
  });

  it('resolves built-in and unknown variables', () => {
    expect(resolve('{{$timestamp}} {{missing}}', {}, () => 1_700_000_000_000)).toBe('1700000000 {{missing}}');
    expect(resolve('{{$uuid}}', {})).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  it('sends a request and reports the response', async () => {
    let t = 0;
    const fake = jest.fn(async (_url: string, init: RequestInit) => {
      t = 120;
      return new Response(JSON.stringify({ ok: true, method: init.method }), { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' } });
    });
    const res = await send({ name: 'x', method: 'POST', url: 'http://localhost:3000/a', headers: [['Content-Type', 'application/json']], body: '{}', line: 1 }, fake as unknown as typeof fetch, () => t);
    expect(fake.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });
    expect(res).toMatchObject({ status: 201, statusText: 'Created', ms: 120, truncated: false });
    expect(formatBody(res.body, res.headers)).toBe('{\n  "ok": true,\n  "method": "POST"\n}');
  });

  it('explains why plain http to the internet fails on iOS', async () => {
    const failing = (async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;
    await expect(send({ name: 'x', method: 'GET', url: 'http://example.com', headers: [], body: '', line: 1 }, failing)).rejects.toThrow('use https://');
    await expect(send({ name: 'x', method: 'GET', url: 'http://localhost:1', headers: [], body: '', line: 1 }, failing)).rejects.toThrow(/^Network request failed$/);
    expect(isLocal('http://192.168.1.4:8080/x')).toBe(true);
    expect(isLocal('https://api.github.com')).toBe(false);
  });
});
