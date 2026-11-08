import { createHistoryStore, migrateHistory, MAX_STORED_BODY, PER_REQUEST, redact, REDACTED, redactBody, redactUrl, restoreHeaders, restoreRequest } from './history';

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
        // A secret-named array or object goes whole.
        body: `{"user":"me","password":"${R}","nested":{"client_secret":"${R}","tokens":"${R}"},"list":[{"api_key":"${R}"}]}`,
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

  describe('more credentials (2.0.2)', () => {
    const R = REDACTED;

    it('redacts secrets in the path: Slack, Discord and Telegram tokens and long random keys', () => {
      expect(redactUrl('https://hooks.slack.com/services/T0123ABCD/B0456EFGH/abcdEFGHijklMNOPqrstUVWX')).toBe(`https://hooks.slack.com/services/T0123ABCD/B0456EFGH/${R}`);
      expect(redactUrl('https://discord.com/api/webhooks/123456789012345678/AbC-dEf_GhIjK')).toBe(`https://discord.com/api/webhooks/123456789012345678/${R}`);
      expect(redactUrl('https://discord.com/api/v10/webhooks/1234/tok/github')).toBe(`https://discord.com/api/v10/webhooks/1234/${R}/github`);
      expect(redactUrl('https://api.telegram.org/bot123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage?chat_id=1')).toBe(`https://api.telegram.org/bot${R}/sendMessage?chat_id=1`);
      expect(redactUrl('https://api.example.com/v1/k/x7Gq2LmP9vRt4WzY8bNc3HdK/items')).toBe(`https://api.example.com/v1/k/${R}/items`);
      // Conservative: words, slugs, CamelCase names, UUIDs and commit ids stay.
      for (const url of [
        'https://blog.dev/posts/my-long-article-title-about-2024',
        'https://x.dev/MyVeryLongCamelCaseName2024/page',
        'https://x.dev/items/123e4567-e89b-12d3-a456-426614174000',
        'https://api.github.com/repos/a/b/commits/0123456789abcdef0123456789abcdef01234567',
        'https://x.dev/short/a1B2c3',
      ]) {
        expect(redactUrl(url)).toBe(url);
      }
    });

    it('fills a redacted path segment back in from today\'s URL of the same shape', () => {
      const stored = { method: 'POST', url: redactUrl('https://hooks.slack.com/services/T1/B1/abcdEFGHijklMNOPqrstUVWX'), headers: [] as [string, string][], body: '{"text":"hi"}' };
      const today = { method: 'POST', url: 'https://hooks.slack.com/services/T1/B1/zyxwVUTSrqpoNMLKjihgFEDC', headers: [] as [string, string][], body: '' };
      expect(restoreRequest(stored, today)).toMatchObject({ url: today.url, body: '{"text":"hi"}' });
    });

    it('never fills today\'s credentials into a request to another host, scheme or port', () => {
      const store = createHistoryStore(memory());
      store.getState().add(
        'k',
        { method: 'POST', url: 'https://old.dev/login?token=old', headers: [['Authorization', 'Bearer old']], body: '{"password":"old"}' },
        response(200),
      );
      const [e] = store.getState().entries.k;
      const today = { method: 'GET', url: 'https://new.dev/login?token=NEW', headers: [['Authorization', 'Bearer NEW']] as [string, string][], body: '{"password":"NEW"}' };
      expect(restoreRequest(e.request, today)).toEqual(today);
      for (const url of ['http://old.dev/login?token=NEW', 'https://old.dev:8443/login?token=NEW']) {
        expect(restoreRequest(e.request, { ...today, url })).toEqual({ ...today, url });
      }
      // Same origin (default port spelled out, host in capitals): filled in.
      const same = restoreRequest(e.request, { ...today, url: 'https://OLD.dev:443/login?token=NEW' });
      expect(same).toMatchObject({ method: 'POST', url: 'https://old.dev/login?token=NEW', headers: [['Authorization', 'Bearer NEW']], body: '{"password":"NEW"}' });
    });

    it('redacts API-key headers by the same rule as query and body fields', () => {
      const names = ['x-goog-api-key', 'apikey', 'dd-api-key', 'x-rapidapi-key', 'ocp-apim-subscription-key', 'x-algolia-api-key', 'Cookie', 'X-Api-Key'];
      expect(redact(names.map((n) => [n, 'v']))).toEqual(names.map((n) => [n, R]));
      expect(redact([['Accept', 'json'], ['Content-Type', 'x']])).toEqual([['Accept', 'json'], ['Content-Type', 'x']]);
    });

    it('redacts secret fields in JSON and form response bodies, even cut short', () => {
      const store = createHistoryStore(memory());
      const req = { method: 'POST', url: 'https://auth.dev/token', headers: [], body: '' };
      store.getState().add('k', req, response(200, '{"access_token":"at-secret","token_type":"bearer","refresh_token":"rt-secret","expires_in":3600}'));
      store.getState().add('f', req, { ...response(200, 'access_token=at-secret&scope=read'), headers: [['content-type', 'application/x-www-form-urlencoded']] });
      const cut = `{"id_token":"it-secret","items":[${'1,'.repeat(MAX_STORED_BODY)}`;
      store.getState().add('c', req, { ...response(200, cut), truncated: true });
      expect(JSON.parse(store.getState().entries.k[0].response.body)).toEqual({ access_token: R, token_type: 'bearer', refresh_token: R, expires_in: 3600 });
      expect(store.getState().entries.f[0].response.body).toBe(`access_token=${R}&scope=read`);
      expect(JSON.stringify(store.getState())).not.toMatch(/secret/);
    });

    it('redacts history saved by older versions when it loads', async () => {
      const m = memory();
      const old = {
        state: {
          entries: {
            k: [
              {
                at: 1,
                request: { method: 'GET', url: 'https://hooks.slack.com/services/T1/B1/abcdEFGHijklMNOPqrstUVWX', headers: [['x-goog-api-key', 'g-secret']], body: '{"credentials":{"a":"b-secret"}}' },
                response: { status: 200, statusText: 'OK', headers: [], body: '{"access_token":"at-secret"}', ms: 1, bytes: 1, truncated: false },
              },
            ],
          },
        },
        version: 1,
      };
      m.setItem('http-history', JSON.stringify(old));
      const store = createHistoryStore(m);
      await store.persist.rehydrate();
      const [e] = store.getState().entries.k;
      expect(e.request.url).toBe(`https://hooks.slack.com/services/T1/B1/${R}`);
      expect(e.request.headers).toEqual([['x-goog-api-key', R]]);
      expect(JSON.stringify(store.getState())).not.toMatch(/secret/);
      expect(migrateHistory(null, 1)).toEqual({ entries: {} });
    });
  });
});
