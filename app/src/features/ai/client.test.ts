/**
 * @jest-environment node
 */
jest.mock('expo-secure-store', () => require('./testMocks').secureStoreMock());
jest.mock('../../state', () => require('./testMocks').stateMock());

import * as SecureStore from 'expo-secure-store';

import { agentStep, aiReady, chat, complete, completionPrompt } from './client';
import { DEFAULT_JOBS } from './providers/catalog';
import { AiError } from './providers/types';
import { aiSettings, DEFAULTS, migrateAiSettings, refreshKeys, setKey } from './settings';
import { connectProvider } from './setup';
import { fakeFetch, json, sse } from './testMocks';
import { costOf, createUsageStore, monthOf, usageStore } from './usage';

const items = (SecureStore as unknown as { __items: Map<string, string> }).__items;
const realFetch = global.fetch;

const claudeReply = (text: string, model = 'claude-haiku-5-5', usage = { input_tokens: 1000, output_tokens: 100 }) =>
  json({ id: 'm', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage });

// A reply whose headers arrive but whose body never does, until the request
// is stopped (`answered` runs once the headers are in).
const stalledReply = (answered: () => void) =>
  (async (_url: string, init: RequestInit = {}) => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        init.signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      },
    });
    setTimeout(answered, 0);
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;

beforeEach(async () => {
  items.clear();
  aiSettings.setState({ ...DEFAULTS, hasKey: null });
  usageStore.setState({ month: monthOf(new Date()), byModel: {} });
  await refreshKeys(true);
});
afterAll(() => {
  global.fetch = realFetch;
});

describe('settings', () => {
  it('moves the old single model into the chat job, with the new defaults', () => {
    expect(migrateAiSettings({ model: 'claude-haiku-5-5' }, 1)).toEqual({ ...DEFAULTS, jobs: { ...DEFAULT_JOBS, chat: { provider: 'anthropic', model: 'claude-haiku-5-5' } } });
    const fresh = migrateAiSettings(undefined, 0);
    expect(fresh.completions).toBe(true);
    expect(fresh.monthlyLimitUsd).toBe(10);
    expect(fresh.jobs.chat).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
  });

  it('finds a key saved under the old Keychain name', async () => {
    expect(aiReady('chat')).toBe(false);
    items.set('tide.ai.anthropic-key', 'sk-ant-old');
    await refreshKeys(true);
    expect(aiSettings.getState().connected).toEqual({ anthropic: true });
    expect(aiSettings.getState().hasKey).toBe(true);
    expect(aiReady('agent')).toBe(true);
  });

  it('keeps one Keychain entry per provider, and points unset jobs at a newly connected one', async () => {
    const f = fakeFetch(() => json({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }));
    global.fetch = f.fetch;
    await connectProvider('openai', ' sk-openai ');
    expect(items.get('tide.ai.openai-key')).toBe('sk-openai');
    expect(f.calls[0]).toMatchObject({ url: 'https://api.openai.com/v1/models', method: 'GET' });
    expect(aiSettings.getState().jobs).toEqual({ agent: { provider: 'openai', model: 'gpt-5' }, chat: { provider: 'openai', model: 'gpt-5-mini' }, complete: { provider: 'openai', model: 'gpt-5-nano' } });
    expect(aiSettings.getState().knownModels.openai).toEqual(['gpt-5', 'gpt-5-mini']);
    expect(aiReady('complete')).toBe(true);
  });

  it('sets up your own server with an address and no key', async () => {
    const f = fakeFetch(() => json({ object: 'list', data: [{ id: 'qwen2.5-coder:7b' }] }));
    global.fetch = f.fetch;
    await connectProvider('custom', '', 'http://192.168.1.20:11434/v1/');
    expect(f.calls[0].url).toBe('http://192.168.1.20:11434/v1/models');
    expect(f.calls[0].headers.get('authorization')).toBeNull();
    expect(aiSettings.getState().connected.custom).toBe(true);
    expect(aiSettings.getState().jobs.agent).toEqual({ provider: 'custom', model: 'qwen2.5-coder:7b' });
  });
});

describe('usage and the spend limit', () => {
  it('prices Claude models per million tokens, and leaves others unknown', () => {
    expect(costOf('anthropic', 'claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
    expect(costOf('anthropic', 'claude-sonnet-5-5', { inputTokens: 500_000, outputTokens: 100_000 })).toBe(2);
    expect(costOf('anthropic', 'claude-haiku-5-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.1);
    expect(costOf('openai', 'gpt-5', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it('adds up a calendar month, and starts again in the next', () => {
    const store = createUsageStore({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    const nov = new Date(2026, 10, 3);
    store.getState().record('anthropic', 'claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 0 }, nov);
    store.getState().record('anthropic', 'claude-sonnet-5-5', { inputTokens: 0, outputTokens: 100_000 }, nov);
    store.getState().record('custom', 'llama3', { inputTokens: 50, outputTokens: 5 }, nov);
    expect(store.getState().totals(nov)).toEqual({ inputTokens: 1_000_050, outputTokens: 100_005, costUsd: 3, unknownPrice: true, unpricedTokens: 55 });
    const sonnet = store.getState().current(nov).find((e) => e.model === 'claude-sonnet-5-5');
    expect(sonnet).toMatchObject({ requests: 2, costUsd: 3 });
    const dec = new Date(2026, 11, 1);
    expect(store.getState().totals(dec).costUsd).toBe(0);
    expect(store.getState().current(dec)).toEqual([]);
    expect(store.getState().month).toBe('2026-12');
  });

  it('records what each request used, under the model that answered', async () => {
    await setKey('anthropic', 'sk-ant');
    global.fetch = fakeFetch(() => claudeReply('hi', 'claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 0 })).fetch;
    await chat({ job: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(usageStore.getState().totals().costUsd).toBe(2);
  });

  it('stops at the limit: chat and the agent throw, completions go quiet', async () => {
    await setKey('anthropic', 'sk-ant');
    const f = fakeFetch(() => claudeReply('x'));
    global.fetch = f.fetch;
    aiSettings.getState().setMonthlyLimit(5);
    usageStore.getState().record('anthropic', 'claude-opus-5-5', { inputTokens: 1_250_000, outputTokens: 0 });
    const err = await chat({ job: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('limit');
    expect(err.message).toContain('$5.00');
    await expect(agentStep({ system: 's', history: [{ role: 'user', text: 'u' }], tools: [] })).rejects.toMatchObject({ kind: 'limit' });
    expect(await complete({ path: 'a.ts', language: 'typescript', prefix: 'const a = ', suffix: '' })).toBe('');
    expect(f.calls).toHaveLength(0);
    // No limit: it goes through.
    aiSettings.getState().setMonthlyLimit(null);
    await chat({ job: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(f.calls).toHaveLength(1);
  });

  it('stops models without a price at the token limit, not the dollar limit', async () => {
    await setKey('openai', 'sk-openai');
    aiSettings.getState().setJob('chat', { provider: 'openai', model: 'gpt-5' });
    const f = fakeFetch(() => json({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    global.fetch = f.fetch;
    // Far past $10 worth of tokens at any real price, but $0 to the dollar limit.
    usageStore.getState().record('openai', 'gpt-5', { inputTokens: 1_500_000, outputTokens: 499_990 });
    await chat({ job: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(usageStore.getState().totals().unpricedTokens).toBe(2_000_002);
    const err = await chat({ job: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] }).catch((e) => e);
    expect(err).toMatchObject({ kind: 'limit' });
    expect(err.message).toContain('2.0M tokens');
    expect(f.calls).toHaveLength(1);
    aiSettings.getState().setUnpricedTokenLimit(null);
    await chat({ job: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(f.calls).toHaveLength(2);
  });

  it('counts a stream that failed partway, and a request that was stopped', async () => {
    await setKey('openai', 'sk-openai');
    aiSettings.getState().setJob('agent', { provider: 'openai', model: 'gpt-5' });
    global.fetch = fakeFetch(() => sse([{ data: { choices: [{ delta: { content: 'x'.repeat(400) } }] } }, { data: { error: { code: 500, message: 'overloaded' } } }])).fetch;
    const history = [{ role: 'user' as const, text: 'u'.repeat(4000) }];
    await expect(agentStep({ system: 's', history, tools: [] })).rejects.toBeInstanceOf(AiError);
    const after = usageStore.getState().current().find((e) => e.model === 'gpt-5')!;
    expect(after.outputTokens).toBe(100);
    expect(after.inputTokens).toBeGreaterThan(1000);

    // Stopped before the server answered at all: nothing was worked on, not counted.
    const controller = new AbortController();
    controller.abort();
    global.fetch = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    await expect(agentStep({ system: 's', history, tools: [], signal: controller.signal })).rejects.toBeDefined();
    expect(usageStore.getState().current().find((e) => e.model === 'gpt-5')!.requests).toBe(1);

    // Stopped after the server answered, before any text: what was sent counts.
    const later = new AbortController();
    global.fetch = stalledReply(() => later.abort());
    await expect(agentStep({ system: 's', history, tools: [], signal: later.signal })).rejects.toBeDefined();
    expect(usageStore.getState().current().find((e) => e.model === 'gpt-5')!.requests).toBe(2);

    // A request turned away before any reply (a bad key) isn't counted.
    global.fetch = fakeFetch(() => json({ error: { message: 'bad key' } }, 401)).fetch;
    await expect(agentStep({ system: 's', history, tools: [] })).rejects.toBeInstanceOf(AiError);
    expect(usageStore.getState().current().find((e) => e.model === 'gpt-5')!.requests).toBe(2);
  });

  it('never counts an inline completion that a newer one replaced', async () => {
    await setKey('openai', 'sk-openai');
    aiSettings.getState().setJob('complete', { provider: 'openai', model: 'gpt-5' });
    // Stopped after the server answered (the user kept typing).
    const superseded = new AbortController();
    global.fetch = stalledReply(() => superseded.abort());
    await expect(complete({ path: 'a.ts', language: 'typescript', prefix: 'const a = ', suffix: '', signal: superseded.signal })).rejects.toBeDefined();
    // And stopped before it got anywhere.
    const early = new AbortController();
    early.abort();
    global.fetch = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    await expect(complete({ path: 'a.ts', language: 'typescript', prefix: 'const a = ', suffix: '', signal: early.signal })).rejects.toBeDefined();
    expect(usageStore.getState().current().find((e) => e.model === 'gpt-5')).toBeUndefined();
  });

  it('says what to set up when there is no key', async () => {
    await expect(chat({ job: 'chat', system: 's', messages: [] })).rejects.toMatchObject({ kind: 'no-key', message: 'Add your Anthropic API key in Settings, AI assistant.' });
    expect(await complete({ path: 'a', language: 'js', prefix: '', suffix: '' })).toBe('');
  });
});

describe('inline completions', () => {
  it('asks Haiku for the text at the cursor, with little effort and few tokens', async () => {
    await setKey('anthropic', 'sk-ant');
    const f = fakeFetch(() => claudeReply('```ts\nb + 1;\n```'));
    global.fetch = f.fetch;
    const prefix = `${'// filler line\n'.repeat(600)}const a = `;
    const suffix = `\n${'x\n'.repeat(1000)}`;
    const text = await complete({ path: 'src/a.ts', language: 'typescript', prefix, suffix });
    expect(text).toBe('b + 1;');
    const body = f.calls[0].body;
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 256, output_config: { effort: 'low' } });
    expect(body.fallbacks).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    const sent: string = body.messages[0].content;
    expect(sent).toContain('const a = <CURSOR/>');
    expect(sent.length).toBeLessThan(4000 + 1000 + 200);
    expect(body.messages).toHaveLength(1);
  });

  it('returns nothing when completions are off or the model refuses', async () => {
    await setKey('anthropic', 'sk-ant');
    const f = fakeFetch(() => json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: 'refusal', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } }));
    global.fetch = f.fetch;
    expect(await complete({ path: 'a', language: 'js', prefix: 'x', suffix: '' })).toBe('');
    aiSettings.getState().setCompletions(false);
    expect(await complete({ path: 'a', language: 'js', prefix: 'x', suffix: '' })).toBe('');
    expect(f.calls).toHaveLength(1);
  });

  it('trims the prompt to the code near the cursor', () => {
    const p = completionPrompt({ path: 'a.py', language: 'python', prefix: 'a\n'.repeat(5000), suffix: 'b\n'.repeat(5000) });
    expect(p.startsWith('<file path="a.py" language="python">\n')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(4000 + 1000 + 60);
  });
});
