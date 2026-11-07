import { createHistoryStore, MAX_STORED_BODY, PER_REQUEST, REDACTED, redactBody, redactUrl, restoreHeaders, restoreRequest } from './history';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const response = (status: number, body = '{}') => ({ status, statusText: 'OK', headers: [['set-cookie', 's=1'], ['content-type', 'application/json']] as [string, string][], body, ms: 5, bytes: body.length, truncated: false });

describe('HTTP history', () => {
  it('keeps the newest responses per request, without credentials', () => {
    const store = createHistoryStore(memory());
    const req = { method: 'GET', url: 'https://x.dev', headers: [['Authorization', 'Bearer abc'], ['X-Refresh-Token', 't'], ['Accept', 'json']] as [string, string][], body: '' };
    for (let i = 0; i < PER_REQUEST + 2; i++) store.getState().add('k', req, response(200 + i), i);
    const list = store.getState().entries.k;
    expect(list).toHaveLength(PER_REQUEST);
    expect(list[0].response.status).toBe(200 + PER_REQUEST + 1);
    expect(list[0].request.headers).toEqual([
      ['Authorization', REDACTED],
      ['X-Refresh-Token', REDACTED],
      ['Accept', 'json'],
    ]);
    expect(list[0].response.headers[0]).toEqual(['set-cookie', REDACTED]);
  });

  it('cuts big bodies and says so', () => {
    const store = createHistoryStore(memory());
    store.getState().add('k', { method: 'GET', url: 'u', headers: [], body: '' }, response(200, 'x'.repeat(MAX_STORED_BODY + 5)));
    const [e] = store.getState().entries.k;
    expect(e.response.body).toHaveLength(MAX_STORED_BODY);
    expect(e.response.truncated).toBe(true);
  });

  it('fills redacted headers from the current request when resending', () => {
    expect(
      restoreHeaders(
        [
          ['Authorization', REDACTED],
          ['Accept', 'json'],
          ['Cookie', REDACTED],
        ],
        [['authorization', 'Bearer new']],
      ),
    ).toEqual([
      ['Authorization', 'Bearer new'],
      ['Accept', 'json'],
    ]);
  });

  describe('credentials outside headers (L15)', () => {
    const R = REDACTED;

    it('redacts user:pass@ and secret-named query and fragment parameters, keeping the rest', () => {
      expect(redactUrl('https://me:hunter2@api.dev/v1/items?page=2&access_token=abc&api_key=k&keyword=cats&sort=asc')).toBe(
        `https://me:${R}@api.dev/v1/items?page=2&access_token=${R}&api_key=${R}&keyword=cats&sort=asc`,
      );
      expect(redactUrl('https://ghp_123@github.com/a/b.git')).toBe(`https://${R}@github.com/a/b.git`);
      for (const name of ['token', 'apikey', 'key', 'secret', 'password', 'auth', 'signature', 'sig', 'code', 'client_secret', 'X-Amz-Signature', 'refresh_token']) {
        expect(redactUrl(`https://x.dev/cb?${name}=v&state=s`)).toBe(`https://x.dev/cb?${name}=${R}&state=s`);
      }
      expect(redactUrl('https://x.dev/cb#access_token=t&token_type=bearer&expires_in=3600')).toBe(`https://x.dev/cb#access_token=${R}&token_type=bearer&expires_in=3600`);
      // Nothing to hide: unchanged, including a path with @ in it.
      expect(redactUrl('https://x.dev/@user/posts?author=me#top')).toBe('https://x.dev/@user/posts?author=me#top');
    });

    it('keeps JSON and form bodies with secret fields redacted, and leaves other bodies out', () => {
      expect(redactBody('{"user":"me","password":"pw","nested":{"client_secret":"s","tokens":[1]},"list":[{"api_key":"k"}]}', [])).toEqual({
        body: `{"user":"me","password":"${R}","nested":{"client_secret":"${R}","tokens":[1]},"list":[{"api_key":"${R}"}]}`,
      });
      expect(redactBody('{"query":"{ me { id } }"}', [])).toEqual({ body: '{"query":"{ me { id } }"}' });
      expect(redactBody('grant_type=password&username=me&password=pw&code=c', [['Content-Type', 'application/x-www-form-urlencoded']])).toEqual({
        body: `grant_type=password&username=me&password=${R}&code=${R}`,
      });
      expect(redactBody('<login><password>pw</password></login>', [['Content-Type', 'application/xml']])).toEqual({ body: '', bodyOmitted: true });
      expect(redactBody('', [])).toEqual({ body: '' });
    });

    it('stores the redacted request, and resending fills credentials in from today\'s request', () => {
      const store = createHistoryStore(memory());
      const sent = {
        method: 'POST',
        url: 'https://me:pw@x.dev/login?token=old&page=1',
        headers: [['Content-Type', 'application/json']] as [string, string][],
        body: '{"user":"me","password":"old"}',
      };
      store.getState().add('k', { ...sent, name: 'login', line: 3 } as typeof sent, response(200));
      const [e] = store.getState().entries.k;
      expect(e.request).toEqual({ method: 'POST', url: `https://me:${R}@x.dev/login?token=${R}&page=1`, headers: sent.headers, body: `{"user":"me","password":"${R}"}` });
      expect(JSON.stringify(store.getState())).not.toMatch(/old|:pw@/);

      const today = { ...sent, url: 'https://me:new@x.dev/login?token=new', body: '{"user":"someone","password":"new"}' };
      expect(restoreRequest(e.request, today)).toMatchObject({
        url: 'https://me:new@x.dev/login?token=new&page=1',
        body: '{"user":"me","password":"new"}',
      });
      // No current value: the parameter is dropped rather than sent as dots.
      expect(restoreRequest(e.request, { ...today, url: 'https://x.dev/login' }).url).toBe('https://x.dev/login?page=1');
    });

    it('resends an omitted body as today\'s', () => {
      const store = createHistoryStore(memory());
      store.getState().add('k', { method: 'POST', url: 'https://x.dev', headers: [['Content-Type', 'text/plain']], body: 'secret stuff' }, response(200));
      const [e] = store.getState().entries.k;
      expect(e.request).toMatchObject({ body: '', bodyOmitted: true });
      expect(restoreRequest(e.request, { method: 'POST', url: 'https://x.dev', headers: [], body: 'today' }).body).toBe('today');
    });
  });
});
