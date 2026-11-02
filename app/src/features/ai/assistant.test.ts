/**
 * @jest-environment node
 */
import { createClient, describeError, extractCode, lastErrorLine, runTask } from './assistant';

function fakeAnthropic(reply: (body: any) => { status?: number; body: unknown }) {
  const calls: { url: string; headers: Headers; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), headers: new Headers(init.headers), body });
    const r = reply(body);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { client: createClient('sk-ant-test', fetchImpl), calls };
}

const message = (text: string, stop_reason = 'end_turn', extra: object = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 20 },
  ...extra,
});

const file = { path: 'src/sum.js', content: 'export const sum = (a, b) => a - b;\n' };

describe('AI assistant', () => {
  it('sends the file with the key, the model and server-side fallbacks, and returns the fixed file', async () => {
    const { client, calls } = fakeAnthropic(() => ({ body: message('Here:\n\n```js\nexport const sum = (a, b) => a + b;\n```\n\n- `-` was `+`') }));
    const answer = await runTask(client, 'claude-opus-5-5', { kind: 'fix' }, file);
    expect(answer.code).toBe('export const sum = (a, b) => a + b;');
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk-ant-test');
    expect(calls[0].headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(calls[0].body).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 16000, fallbacks: 'default' });
    expect(calls[0].body.messages[0].content).toContain('<file path="src/sum.js">');
    expect(calls[0].body.thinking).toBeUndefined();
  });

  it('leaves fallbacks out for Haiku, and never offers code from an explanation', async () => {
    const { client, calls } = fakeAnthropic(() => ({ body: message('It adds.\n\n```js\nx\n```') }));
    const answer = await runTask(client, 'claude-haiku-5-5', { kind: 'explain' }, file);
    expect(answer.code).toBeNull();
    expect(calls[0].body.fallbacks).toBeUndefined();
    expect(calls[0].headers.get('anthropic-beta') ?? '').not.toContain('server-side-fallback');
  });

  it('explains an error from program output, with the tail of the output and a fix', async () => {
    const { client, calls } = fakeAnthropic(() => ({ body: message('`a - b` subtracts.\n\n```js\nexport const sum = (a, b) => a + b;\n```') }));
    const output = `${'noise\n'.repeat(3000)}AssertionError: expected 3, got -1\n    at test (src/sum.test.js:4:3)`;
    const answer = await runTask(client, 'claude-opus-5-5', { kind: 'error', output }, file);
    const sent: string = calls[0].body.messages[0].content;
    expect(sent).toContain('<file path="src/sum.js">');
    expect(sent).toContain('AssertionError: expected 3, got -1');
    expect(sent.length).toBeLessThan(7500);
    expect(answer.code).toBe('export const sum = (a, b) => a + b;');
  });

  it('picks the line that names the error, not a stack frame', () => {
    expect(lastErrorLine('$ node app.js\nTypeError: x.map is not a function\n    at main (/p/app.js:3:5)\n')).toBe('TypeError: x.map is not a function');
    expect(lastErrorLine('Traceback (most recent call last):\n  File "a.py", line 1\nZeroDivisionError: division by zero')).toBe('ZeroDivisionError: division by zero');
    expect(lastErrorLine('something odd happened')).toBe('something odd happened');
  });

  it('reports refusals and cut-off answers', async () => {
    const refused = fakeAnthropic(() => ({ body: message('', 'refusal', { content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: 'Not this one.' } }) }));
    await expect(runTask(refused.client, 'claude-sonnet-5-5', { kind: 'ask', prompt: 'x' }, file)).rejects.toThrow('declined this request: Not this one.');
    const cut = fakeAnthropic(() => ({ body: message('```js\nhalf', 'max_tokens') }));
    const answer = await runTask(cut.client, 'claude-opus-5-5', { kind: 'fix' }, file);
    expect(answer.code).toBeNull();
    expect(answer.text).toContain('cut off');
  });

  it('explains API errors and refuses huge files before sending', async () => {
    const { client } = fakeAnthropic(() => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
    const err = await runTask(client, 'claude-opus-5-5', { kind: 'explain' }, file).catch((e) => e);
    expect(describeError(err)).toContain('didn’t accept the API key');
    await expect(runTask(client, 'claude-opus-5-5', { kind: 'explain' }, { path: 'big.js', content: 'x'.repeat(400_001) })).rejects.toThrow('too big');
  });

  it('takes the last code block', () => {
    expect(extractCode('a\n```\none\n```\nb\n```ts\ntwo\n```')).toBe('two');
    expect(extractCode('no code')).toBeNull();
  });
});
