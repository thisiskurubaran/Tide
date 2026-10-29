import { addInput, clearConsole, emptyDevtools, MAX_ENTRIES, PageMessage, parsePageMessage, reduce, shortUrl } from './devtools';

// Omit, applied to each member of the union.
type WithoutTime = PageMessage extends infer M ? (M extends PageMessage ? Omit<M, 'time'> : never) : never;
const apply = (msgs: WithoutTime[]) => msgs.reduce((s, m) => reduce(s, { ...m, time: 0 } as PageMessage), emptyDevtools());

describe('preview dev tools', () => {
  it('only accepts messages from its own script', () => {
    expect(parsePageMessage('{"kind":"console"}')).toBeNull();
    expect(parsePageMessage('not json')).toBeNull();
    expect(parsePageMessage('{"__tide":true,"kind":"page","url":"x"}')).toMatchObject({ kind: 'page' });
  });

  it('collects console output and counts errors', () => {
    let s = apply([
      { kind: 'console', level: 'log', text: 'hi' },
      { kind: 'console', level: 'error', text: 'boom' },
    ]);
    s = addInput(s, '1 + 1');
    s = reduce(s, { kind: 'eval', id: 1, ok: true, text: '2', time: 0 });
    expect(s.console.map((e) => [e.kind, e.text])).toEqual([
      ['console', 'hi'],
      ['console', 'boom'],
      ['input', '1 + 1'],
      ['result', '2'],
    ]);
    expect(s.errors).toBe(1);
    expect(clearConsole(s)).toMatchObject({ console: [], errors: 0 });
  });

  it('follows requests from start to end, and resets them on a new page', () => {
    let s = apply([
      { kind: 'page', url: 'http://127.0.0.1:3000/', title: '' },
      { kind: 'net', phase: 'start', id: 'f1', method: 'GET', url: 'http://127.0.0.1:3000/api?x=1', type: 'fetch' },
      { kind: 'net', phase: 'start', id: 'f2', method: 'POST', url: 'https://other.dev/save', type: 'xhr' },
      { kind: 'net', phase: 'end', id: 'f1', status: 200, ms: 12, size: 40, contentType: 'application/json' },
      { kind: 'net', phase: 'error', id: 'f2', ms: 5, error: 'Failed to fetch' },
    ]);
    expect(s.requests.map((r) => [r.method, shortUrl(r.url, s.url), r.status, r.error])).toEqual([
      ['GET', '/api?x=1', 200, null],
      ['POST', 'other.dev/save', null, 'Failed to fetch'],
    ]);
    s = reduce(s, { kind: 'page', url: 'http://127.0.0.1:3000/next', title: '', time: 0 });
    expect(s.requests).toEqual([]);
  });

  it('keeps the latest entries only', () => {
    let s = emptyDevtools();
    for (let i = 0; i < MAX_ENTRIES + 20; i++) s = reduce(s, { kind: 'console', level: 'log', text: String(i), time: 0 });
    expect(s.console).toHaveLength(MAX_ENTRIES);
    expect(s.console[0].text).toBe('20');
  });
});
