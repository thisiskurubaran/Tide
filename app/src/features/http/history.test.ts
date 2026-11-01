import { createHistoryStore, MAX_STORED_BODY, PER_REQUEST, REDACTED, restoreHeaders } from './history';

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
});
