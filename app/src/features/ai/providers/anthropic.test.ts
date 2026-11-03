/**
 * @jest-environment node
 */
import { fakeFetch, sse } from '../testMocks';
import { anthropicAgentStep, toAnthropicMessages } from './anthropic';
import { isInvalidToolInput } from './tools';
import type { AgentMessage, ToolSpec } from './types';

const tools: ToolSpec[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

const ev = (data: { type: string } & Record<string, unknown>) => ({ event: data.type, data });

function agentStream(stop = 'tool_use') {
  return sse([
    ev({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 1 } } }),
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
    ev({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } }),
    ev({ type: 'content_block_stop', index: 0 }),
    ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Looking ' } }),
    ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'now.' } }),
    ev({ type: 'content_block_stop', index: 1 }),
    ev({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } }),
    ev({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
    ev({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"a.js"}' } }),
    ev({ type: 'content_block_stop', index: 2 }),
    ev({ type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: {} } }),
    ev({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"path": 3}' } }),
    ev({ type: 'content_block_stop', index: 3 }),
    ev({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null, ...(stop === 'refusal' ? { stop_details: { type: 'refusal', category: null, explanation: 'No.' } } : {}) }, usage: { output_tokens: 30 } }),
    ev({ type: 'message_stop' }),
  ]);
}

describe('Anthropic provider', () => {
  it('streams an agent step with the SDK: effort, fallbacks, eager tool input, text deltas, checked tool calls', async () => {
    const f = fakeFetch(() => agentStream());
    const deltas: string[] = [];
    const { result: step, model } = await anthropicAgentStep(
      { apiKey: 'sk-ant-test', model: 'claude-opus-5-5', fetch: f.fetch },
      { system: 'You are the agent.', history: [{ role: 'user', text: 'Read a.js' }], tools, onText: (d) => deltas.push(d) },
    );
    expect(model).toBe('claude-opus-5-5');
    expect(deltas.join('')).toBe('Looking now.');
    expect(step.text).toBe('Looking now.');
    expect(step.stop).toBe('tool_use');
    expect(step.usage).toEqual({ inputTokens: 50, outputTokens: 30 });
    expect(step.toolCalls[0]).toEqual({ id: 'toolu_1', name: 'read_file', input: { path: 'a.js' } });
    expect(step.toolCalls[1].id).toBe('toolu_2');
    expect(isInvalidToolInput(step.toolCalls[1].input)).toBe(true);

    const req = f.calls[0];
    expect(req.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(req.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, system: 'You are the agent.', fallbacks: 'default', output_config: { effort: 'high' } });
    expect(req.body.thinking).toBeUndefined();
    expect(req.body.tool_choice).toBeUndefined();
    expect(req.body.tools).toEqual([{ name: 'read_file', description: 'Read a file', input_schema: tools[0].inputSchema, eager_input_streaming: true }]);
    expect(req.body.messages).toEqual([{ role: 'user', content: 'Read a.js' }]);

    // The next turn replays Claude's content unchanged, thinking included,
    // and both results go back in one user message.
    const history: AgentMessage[] = [
      { role: 'user', text: 'Read a.js' },
      { role: 'assistant', text: step.text, toolCalls: step.toolCalls, raw: step.raw },
      {
        role: 'tool',
        results: [
          { id: 'toolu_1', content: 'x = 1' },
          { id: 'toolu_2', content: '{"INVALID_JSON":"{\\"path\\":3}"}', isError: true },
        ],
      },
    ];
    const msgs = toAnthropicMessages(history);
    expect(msgs).toHaveLength(3);
    expect(msgs[1].role).toBe('assistant');
    const content = msgs[1].content as { type: string }[];
    expect(content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use', 'tool_use']);
    expect(content[0]).toMatchObject({ type: 'thinking', signature: 'sig123' });
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'x = 1' },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: '{"INVALID_JSON":"{\\"path\\":3}"}', is_error: true },
      ],
    });
  });

  it('never runs the tools of a refused turn, and leaves them out of the replay', async () => {
    const f = fakeFetch(() => agentStream('refusal'));
    const { result: step } = await anthropicAgentStep({ apiKey: 'k', model: 'claude-sonnet-5-5', fetch: f.fetch }, { system: 's', history: [{ role: 'user', text: 'u' }], tools });
    expect(step.stop).toBe('refusal');
    expect(step.refusal).toBe('No.');
    expect(step.text).toBe('');
    expect(step.toolCalls).toEqual([]);
    expect((step.raw as { content: { type: string }[] }).content.map((b) => b.type)).toEqual(['thinking', 'text']);
    expect(f.calls[0].body.output_config).toEqual({ effort: 'high' });
  });

  it('rebuilds an assistant turn another provider wrote, and skips empty ones', () => {
    const msgs = toAnthropicMessages([
      { role: 'user', text: 'u' },
      { role: 'assistant', text: 'ok', toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'b' } }], raw: { provider: 'openai-compatible', message: {} } },
      { role: 'assistant', text: '', toolCalls: [], raw: null },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: 'u' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'b' } },
        ],
      },
    ]);
  });

  it('reports API errors from the stream as SDK errors', async () => {
    const f = fakeFetch(() => new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429, headers: { 'content-type': 'application/json', 'x-should-retry': 'false' } }));
    const err = await anthropicAgentStep({ apiKey: 'k', model: 'claude-haiku-5-5', fetch: f.fetch }, { system: 's', history: [{ role: 'user', text: 'u' }], tools }).catch((e) => e);
    expect(err.status).toBe(429);
  });
});
