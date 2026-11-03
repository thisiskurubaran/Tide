import type { AgentMessage, AgentStep, AgentStepRequest, ToolCall } from '../ai/client';
import { AiError } from '../ai/providers/types';
import { AgentEvent, buildSystemPrompt, Decision, findTestCommand, runAgent } from './agent';
import { AGENT_TOOLS } from './tools';
import { testEnv } from './testUtils';

const usage = { inputTokens: 100, outputTokens: 10 };
const call = (id: string, name: string, input: unknown): ToolCall => ({ id, name, input });
const toolTurn = (calls: ToolCall[], text = ''): AgentStep => ({ text, toolCalls: calls, stop: 'tool_use', usage, raw: { calls } });
const endTurn = (text: string): AgentStep => ({ text, toolCalls: [], stop: 'end', usage, raw: { text } });

// A fake model: answers each step from the script and records what it was sent.
function script(...turns: (AgentStep | ((req: AgentStepRequest) => AgentStep | Promise<AgentStep>))[]) {
  const requests: AgentMessage[][] = [];
  const step = async (req: AgentStepRequest) => {
    requests.push(structuredClone(req.history));
    const next = turns.shift();
    if (!next) throw new Error('script ran out');
    return typeof next === 'function' ? next(req) : next;
  };
  return { step, requests };
}

function setup(files: Record<string, string> = { 'a.js': 'const x = 1;\n' }, decision: Decision = 'once') {
  const t = testEnv(files, () => ({ output: 'ok\n', code: 0, timedOut: false }));
  const confirms: string[] = [];
  const events: AgentEvent[] = [];
  const base = {
    tools: AGENT_TOOLS,
    env: t.env,
    system: 'sys',
    history: [{ role: 'user', text: 'change x' }] as AgentMessage[],
    confirm: async (req: { command: string }) => {
      confirms.push(req.command);
      return decision;
    },
    onEvent: (e: AgentEvent) => events.push(e),
  };
  return { t, confirms, events, base };
}

describe('runAgent', () => {
  it('runs every tool call of a turn and sends all results back in one message', async () => {
    const { base, t } = setup();
    const s = script(
      toolTurn([call('1', 'read_file', { path: 'a.js' }), call('2', 'edit_file', { path: 'a.js', old_text: 'x = 1', new_text: 'x = 2' }), call('3', 'read_file', { path: 'missing.js' })], 'Reading.'),
      toolTurn([call('4', 'finish', { summary: 'Set x to 2.' })]),
    );
    const result = await runAgent({ ...base, step: s.step });

    expect(result.reason).toBe('finished');
    expect(result.message).toBe('Set x to 2.');
    expect(result.steps).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
    // The second request saw: user, assistant (with its raw content), and one tool message with all three results.
    const second = s.requests[1];
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: 'assistant', text: 'Reading.', toolCalls: expect.any(Array), raw: expect.anything() });
    const results = second[2];
    expect(results.role).toBe('tool');
    if (results.role !== 'tool') return;
    expect(results.results.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(results.results[0].content).toContain('1\tconst x = 1;');
    expect(results.results[1].isError).toBeUndefined();
    // Errors go back as is_error results, not dropped.
    expect(results.results[2]).toEqual({ id: '3', content: expect.stringMatching(/doesn't exist/), isError: true });
    // The edit is pending, not on disk.
    expect(t.disk.get('a.js')).toBe('const x = 1;\n');
    expect(t.changes.getState().byProject.demo['a.js'].proposed).toBe('const x = 2;\n');
    // The history ends with finish's result, so it can be continued.
    expect(result.history[result.history.length - 1]).toEqual({ role: 'tool', results: [{ id: '4', content: 'Finished.' }] });
  });

  it('asks before running a command and returns a denial as an error result', async () => {
    const { base, t, confirms, events } = setup(undefined, 'deny');
    const s = script(toolTurn([call('1', 'run_command', { command: 'npm test' })]), endTurn('Okay, I did not run the tests.'));
    const result = await runAgent({ ...base, step: s.step });
    expect(confirms).toEqual(['npm test']);
    expect(t.commands.commands).toEqual([]);
    const tool = s.requests[1][2];
    expect(tool).toEqual({ role: 'tool', results: [{ id: '1', content: expect.stringMatching(/denied/), isError: true }] });
    expect(result.reason).toBe('end');
    expect(result.message).toBe('Okay, I did not run the tests.');
    expect(events.filter((e) => e.type === 'step').map((e) => e.type === 'step' && e.status)).toEqual(['waiting', 'denied']);
  });

  it('runs an approved command', async () => {
    const { base, t, confirms } = setup(undefined, 'always');
    const s = script(toolTurn([call('1', 'run_command', { command: 'npm test' })]), endTurn('Tests pass.'));
    const result = await runAgent({ ...base, step: s.step });
    expect(confirms).toEqual(['npm test']);
    expect(t.commands.commands).toEqual(['npm test']);
    expect(result.tests).toEqual([{ command: 'npm test', code: 0, timedOut: false, summary: 'ok' }]);
  });

  it('answers unknown tools and invalid input with errors', async () => {
    const { base } = setup();
    const s = script(
      toolTurn([call('1', 'rm_rf', {}), call('2', 'read_file', { path: 7 }), call('3', 'edit_file', { INVALID_JSON: '{"path": "a.js", "old' })]),
      endTurn('Done.'),
    );
    await runAgent({ ...base, step: s.step });
    const tool = s.requests[1][2];
    if (tool.role !== 'tool') throw new Error('expected tool results');
    expect(tool.results.every((r) => r.isError)).toBe(true);
    expect(tool.results[0].content).toMatch(/Unknown tool "rm_rf"/);
    expect(tool.results[1].content).toMatch(/Invalid input for read_file/);
    expect(tool.results[2].content).toContain('INVALID_JSON');
  });

  it('stops on Stop: every call still gets a result and the run ends', async () => {
    const { base, t } = setup();
    const controller = new AbortController();
    const s = script(toolTurn([call('1', 'edit_file', { path: 'a.js', old_text: 'x = 1', new_text: 'x = 2' }), call('2', 'run_command', { command: 'npm test' })]));
    const result = await runAgent({
      ...base,
      step: s.step,
      signal: controller.signal,
      // The user taps Stop while the approval card is showing.
      confirm: () => {
        controller.abort();
        return new Promise<Decision>(() => undefined);
      },
    });
    expect(result.reason).toBe('aborted');
    expect(t.commands.commands).toEqual([]);
    const last = result.history[result.history.length - 1];
    expect(last.role).toBe('tool');
    if (last.role === 'tool') expect(last.results.map((r) => [r.id, !!r.isError])).toEqual([['1', false], ['2', true]]);
  });

  it('stops when the step is aborted mid-request', async () => {
    const { base } = setup();
    const controller = new AbortController();
    const s = script(() => {
      controller.abort();
      throw new Error('aborted');
    });
    const result = await runAgent({ ...base, step: s.step, signal: controller.signal });
    expect(result.reason).toBe('aborted');
    expect(result.history).toEqual(base.history);
  });

  it('ends on a refusal without running that turn’s tools', async () => {
    const { base, t } = setup();
    const s = script({ text: '', toolCalls: [call('1', 'write_file', { path: 'x.js', content: 'partial' })], stop: 'refusal', refusal: 'I can’t help with that.', usage, raw: null });
    const result = await runAgent({ ...base, step: s.step });
    expect(result.reason).toBe('refusal');
    expect(result.message).toBe('The model declined to continue: I can’t help with that.');
    expect(t.changes.getState().byProject.demo).toBeUndefined();
    expect(result.history).toEqual(base.history);
  });

  it('ends on the length limit without running a truncated tool call', async () => {
    const { base, t } = setup();
    const s = script({ text: 'Writing', toolCalls: [call('1', 'write_file', { path: 'x.js', content: 'cut' })], stop: 'length', usage, raw: null });
    const result = await runAgent({ ...base, step: s.step });
    expect(result.reason).toBe('length');
    expect(result.message).toMatch(/length limit/);
    expect(t.changes.getState().byProject.demo).toBeUndefined();
  });

  it('stops after the step limit', async () => {
    const { base } = setup();
    const loop = () => toolTurn([call(String(Math.random()), 'list_files', {})]);
    const s = script(loop, loop, loop);
    const result = await runAgent({ ...base, step: s.step, maxSteps: 3 });
    expect(result.reason).toBe('max-steps');
    expect(result.steps).toBe(3);
  });

  it('reports AI errors with their kind', async () => {
    const { base } = setup();
    const s = script(() => {
      throw new AiError('Add your Anthropic API key in Settings, AI assistant.', 'no-key');
    });
    const result = await runAgent({ ...base, step: s.step });
    expect(result.reason).toBe('error');
    expect((result.error as AiError).kind).toBe('no-key');
    expect(result.message).toMatch(/API key/);
  });

  it('streams text and usage as events', async () => {
    const { base, events } = setup();
    const s = script((req) => {
      req.onText?.('Hel');
      req.onText?.('lo');
      return endTurn('Hello');
    });
    await runAgent({ ...base, step: s.step });
    expect(events).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'usage', step: usage, total: usage },
    ]);
  });
});

describe('system prompt', () => {
  it('names Tide, the project, its files, the runtime and the rules', () => {
    const prompt = buildSystemPrompt({ project: 'shop', files: ['index.js', 'test.js'], scripts: { test: 'node test.js' } });
    expect(prompt).toContain('Tide');
    expect(prompt).toContain('"shop"');
    expect(prompt).toContain('2 files:\nindex.js\ntest.js');
    expect(prompt).toContain('Run help');
    expect(prompt).toContain('run `npm test`');
    expect(prompt).toContain('call finish');
  });

  it('finds a test command', () => {
    expect(findTestCommand({ project: 'p', files: [], scripts: { test: 'echo "Error: no test specified" && exit 1' } })).toBeNull();
    expect(findTestCommand({ project: 'p', files: ['src/sum.test.js'] })).toBe('node src/sum.test.js');
    expect(findTestCommand({ project: 'p', files: ['test_app.py'] })).toBe('python test_app.py');
  });
});
