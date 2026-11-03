/**
 * @jest-environment node
 */
import { fakeFetch, json, sse } from '../testMocks';
import { describeError } from './errors';
import { openAiAgentStep, openAiChat, testOpenAiKey, toOpenAiMessages } from './openaiCompatible';
import { isInvalidToolInput } from './tools';
import type { AgentMessage, ToolSpec } from './types';

const tools: ToolSpec[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
];

describe('OpenAI-style provider', () => {
  it('maps a chat request: URL, key, system message, max tokens and effort', async () => {
    const f = fakeFetch(() => json({ choices: [{ message: { role: 'assistant', content: '<think>hmm</think>Use a map.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
    const res = await openAiChat(
      { provider: 'openai', baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-1', model: 'gpt-5-mini', fetch: f.fetch },
      { job: 'chat', system: 'Be brief.', messages: [{ role: 'user', content: 'How?' }], maxTokens: 500 },
    );
    expect(res).toEqual({ text: 'Use a map.', stop: 'end', usage: { inputTokens: 12, outputTokens: 3 } });
    expect(f.calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(f.calls[0].headers.get('authorization')).toBe('Bearer sk-1');
    expect(f.calls[0].body).toEqual({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'How?' },
      ],
      max_completion_tokens: 500,
      reasoning_effort: 'medium',
    });
  });

  it('sends no key and max_tokens to your own server, and no effort to unknown models', async () => {
    const f = fakeFetch(() => json({ choices: [{ message: { content: 'ok' }, finish_reason: 'length' }] }));
    const res = await openAiChat({ provider: 'custom', baseUrl: 'http://mac.local:11434/v1', apiKey: null, model: 'qwen2.5-coder:7b', fetch: f.fetch }, { job: 'complete', system: 's', messages: [{ role: 'user', content: 'u' }], maxTokens: 64 });
    expect(res.stop).toBe('length');
    expect(f.calls[0].headers.get('authorization')).toBeNull();
    expect(f.calls[0].body.max_tokens).toBe(64);
    expect(f.calls[0].body.reasoning_effort).toBeUndefined();
  });

  it('reports refusals and turns Claude away', async () => {
    const f = fakeFetch(() => json({ choices: [{ message: { content: null, refusal: 'I can’t help with that.' }, finish_reason: 'stop' }] }));
    const res = await openAiChat({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-5', fetch: f.fetch }, { job: 'chat', system: 's', messages: [{ role: 'user', content: 'u' }] });
    expect(res).toMatchObject({ stop: 'refusal', refusal: 'I can’t help with that.', text: '' });
    await expect(openAiChat({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'anthropic/claude-sonnet-5-5', fetch: f.fetch }, { job: 'chat', system: 's', messages: [] })).rejects.toThrow('Anthropic provider');
    expect(f.calls).toHaveLength(1);
  });

  it('streams an agent step: text without reasoning, tool calls joined from fragments, usage', async () => {
    const f = fakeFetch(() =>
      sse([
        JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '<thi' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'nk>plan</think>Reading ' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'it.' } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.js"}' }, extra_content: { google: { thought_signature: 'sig' } } }] } }] }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'read_file', arguments: '{"path":3}' } }] } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
        '[DONE]',
      ]),
    );
    const streamed: string[] = [];
    const step = await openAiAgentStep(
      { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'g', model: 'gemini-2.5-pro', fetch: f.fetch },
      { system: 'Agent.', history: [{ role: 'user', text: 'Read a.js' }], tools, onText: (d) => streamed.push(d) },
    );
    expect(streamed.join('')).toBe('Reading it.');
    expect(step.text).toBe('Reading it.');
    expect(step.stop).toBe('tool_use');
    expect(step.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(step.toolCalls[0]).toEqual({ id: 'call_a', name: 'read_file', input: { path: 'a.js' } });
    // A wrong type doesn't run: it comes back marked for an error result.
    expect(step.toolCalls[1].id).toBe('call_b');
    expect(isInvalidToolInput(step.toolCalls[1].input)).toBe(true);
    const body = f.calls[0].body;
    expect(body).toMatchObject({ model: 'gemini-2.5-pro', stream: true, stream_options: { include_usage: true }, max_tokens: 32000, reasoning_effort: 'high' });
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: tools[0].inputSchema } }]);
    expect(body.messages).toEqual([
      { role: 'system', content: 'Agent.' },
      { role: 'user', content: 'Read a.js' },
    ]);

    // Replayed exactly, thought signature included, with one tool message per result.
    const history: AgentMessage[] = [
      { role: 'user', text: 'Read a.js' },
      { role: 'assistant', text: step.text, toolCalls: step.toolCalls, raw: step.raw },
      {
        role: 'tool',
        results: [
          { id: 'call_a', content: 'x = 1' },
          { id: 'call_b', content: 'bad input', isError: true },
        ],
      },
    ];
    const msgs = toOpenAiMessages('Agent.', history);
    expect(msgs[2]).toMatchObject({ role: 'assistant', content: '<think>plan</think>Reading it.' });
    expect(msgs[2].tool_calls?.[0]).toEqual({ id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' }, extra_content: { google: { thought_signature: 'sig' } } });
    expect(msgs.slice(3)).toEqual([
      { role: 'tool', tool_call_id: 'call_a', content: 'x = 1' },
      { role: 'tool', tool_call_id: 'call_b', content: 'Error: bad input' },
    ]);
  });

  it('rebuilds an assistant turn another provider wrote', () => {
    const msgs = toOpenAiMessages('s', [{ role: 'assistant', text: 'ok', toolCalls: [{ id: 't1', name: 'read_file', input: { path: 'b' } }], raw: { provider: 'anthropic', content: [] } }]);
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'ok', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"b"}' } }] });
  });

  it('drops the tool calls of a cut-off turn', async () => {
    const f = fakeFetch(() => sse([JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'read_file', arguments: '{"pa' } }] }, finish_reason: 'length' }] }), '[DONE]']));
    const step = await openAiAgentStep({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt-5', fetch: f.fetch }, { system: 's', history: [{ role: 'user', text: 'u' }], tools });
    expect(step.stop).toBe('length');
    expect(step.toolCalls).toEqual([]);
    expect((step.raw as { message: { tool_calls?: unknown } }).message.tool_calls).toBeUndefined();
  });

  it('explains HTTP errors and unreachable servers', async () => {
    const unauthorized = fakeFetch(() => json({ error: { message: 'Incorrect API key provided' } }, 401));
    const e1 = await openAiChat({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'bad', model: 'gpt-5', fetch: unauthorized.fetch }, { job: 'chat', system: 's', messages: [] }).catch((e) => e);
    expect(describeError(e1)).toBe('OpenAI didn’t accept the API key. Check it in Settings, AI assistant.');
    const gemini = fakeFetch(() => json([{ error: { code: 429, message: 'Quota exceeded' } }], 429));
    const e2 = await openAiChat({ provider: 'gemini', baseUrl: 'https://x', apiKey: 'k', model: 'gemini-2.5-pro', fetch: gemini.fetch }, { job: 'chat', system: 's', messages: [] }).catch((e) => e);
    expect(describeError(e2)).toContain('Quota exceeded');
    const down = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const e3 = await openAiChat({ provider: 'custom', baseUrl: 'http://mac.local:11434/v1', apiKey: null, model: 'llama3', fetch: down }, { job: 'chat', system: 's', messages: [] }).catch((e) => e);
    expect(describeError(e3)).toBe('Couldn’t reach your server at http://mac.local:11434/v1. Check that it’s running and that this device can reach it.');
  });

  it('tests a key with GET /models, and OpenRouter with /key first', async () => {
    const f = fakeFetch((url) => json(url.endsWith('/key') ? { data: { label: 'k' } } : { data: [{ id: 'models/gemini-2.5-pro' }, { id: 'anthropic/claude-opus-5-5' }, { id: 'qwen/qwen3-coder' }] }));
    expect(await testOpenAiKey({ provider: 'gemini', baseUrl: 'https://g/v1beta/openai', apiKey: 'k', fetch: f.fetch })).toEqual(['gemini-2.5-pro', 'qwen/qwen3-coder']);
    expect(f.calls[0]).toMatchObject({ url: 'https://g/v1beta/openai/models', method: 'GET' });
    await testOpenAiKey({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', fetch: f.fetch });
    expect(f.calls.slice(1).map((c) => c.url)).toEqual(['https://openrouter.ai/api/v1/key', 'https://openrouter.ai/api/v1/models']);
  });
});
