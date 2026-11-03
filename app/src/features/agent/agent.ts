// The agent loop: send the conversation, run the tools the model asks for,
// send every result back in one message, and repeat until it finishes, stops
// on its own, or runs out of steps. Everything it touches is injected
// (step, tools, confirm), so the loop is tested without a model or a device.
import type { AgentMessage, AgentStep, AgentStepRequest, ToolCall, ToolResult, Usage } from '../ai/client';
import { isInvalidToolInput, validateToolInput } from '../ai/providers/tools';
import { AgentTool, commandKey, StepView, TestRun, ToolEnv, ToolError, toolSpecs } from './tools';

export const MAX_STEPS = 40;

export type Decision = 'deny' | 'once' | 'always';

export interface ApprovalRequest {
  id: string;
  command: string;
  // The first word, for "Always for npm".
  key: string;
}

export type StepStatus = 'waiting' | 'running' | 'done' | 'error' | 'denied';

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'step'; id: string; view: StepView; status: StepStatus; detail?: string }
  | { type: 'usage'; step: Usage; total: Usage };

export interface AgentDeps {
  step(req: AgentStepRequest): Promise<AgentStep>;
  tools: AgentTool[];
  env: ToolEnv;
  // Asked before every tool that needs approval (run_command).
  confirm(req: ApprovalRequest): Promise<Decision>;
  system: string;
  // The conversation so far, ending with the user's new message.
  history: AgentMessage[];
  signal?: AbortSignal;
  maxSteps?: number;
  onEvent?(event: AgentEvent): void;
}

export type EndReason = 'finished' | 'end' | 'refusal' | 'length' | 'max-steps' | 'aborted' | 'error';

export interface AgentRun {
  reason: EndReason;
  // What to show at the end of the turn: the summary, or why it stopped.
  message: string;
  // The conversation with this run appended; always valid to continue from.
  history: AgentMessage[];
  usage: Usage;
  steps: number;
  tests: TestRun[];
  error?: unknown;
}

const isAborted = (signal?: AbortSignal) => !!signal?.aborted;

// Resolves to 'aborted' as soon as the signal fires, for racing a pending approval.
function whenAborted(signal?: AbortSignal): Promise<'aborted'> {
  return new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve('aborted');
    else signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runAgent(deps: AgentDeps): Promise<AgentRun> {
  const { signal } = deps;
  const history = [...deps.history];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const tests: TestRun[] = [];
  const specs = toolSpecs(deps.tools);
  const byName = new Map(deps.tools.map((t) => [t.spec.name, t]));
  const max = deps.maxSteps ?? MAX_STEPS;
  const emit = (e: AgentEvent) => deps.onEvent?.(e);
  const end = (reason: EndReason, message: string, steps: number, error?: unknown): AgentRun => ({ reason, message, history, usage, steps, tests, error });
  const stopped = (steps: number) => end('aborted', 'Stopped.', steps);

  async function execute(call: ToolCall): Promise<{ result: ToolResult; finish?: string }> {
    const fail = (content: string) => ({ result: { id: call.id, content, isError: true } });
    const tool = byName.get(call.name);
    if (!tool) return fail(`Unknown tool "${call.name}". Available: ${[...byName.keys()].join(', ')}.`);
    // The provider couldn't parse or validate the input: send it back as an error to retry.
    if (isInvalidToolInput(call.input)) {
      emit({ type: 'step', id: call.id, view: { verb: 'Used', chips: [call.name] }, status: 'error', detail: 'Invalid input' });
      return fail(JSON.stringify(call.input));
    }
    const bad = validateToolInput(tool.spec, call.input);
    const input = (bad ? {} : call.input) as Record<string, unknown>;
    let view: StepView;
    try {
      view = tool.describe(input);
    } catch {
      view = { verb: 'Used', chips: [call.name] };
    }
    if (bad) {
      emit({ type: 'step', id: call.id, view, status: 'error', detail: bad });
      return fail(`Invalid input for ${call.name}: ${bad}.`);
    }

    if (tool.approval) {
      const command = tool.approval(input);
      emit({ type: 'step', id: call.id, view, status: 'waiting' });
      const decision = await Promise.race([deps.confirm({ id: call.id, command, key: commandKey(command) }), whenAborted(signal)]);
      if (decision === 'aborted') {
        emit({ type: 'step', id: call.id, view, status: 'denied', detail: 'Stopped' });
        return fail('The user stopped the run before this command ran.');
      }
      if (decision === 'deny') {
        emit({ type: 'step', id: call.id, view, status: 'denied', detail: 'Denied' });
        return fail("The user denied this command, so it didn't run. Don't retry it; continue without it or explain what you need in your summary.");
      }
    }

    emit({ type: 'step', id: call.id, view, status: 'running' });
    try {
      const outcome = await tool.run(input, deps.env, signal);
      if (outcome.test) tests.push(outcome.test);
      const shown = { ...view, ...outcome.view };
      emit({ type: 'step', id: call.id, view: shown, status: outcome.isError ? 'error' : 'done' });
      return { result: { id: call.id, content: outcome.content, ...(outcome.isError ? { isError: true } : {}) }, finish: outcome.finish };
    } catch (e) {
      const message = e instanceof ToolError ? e.message : `${call.name} failed: ${errorText(e)}`;
      emit({ type: 'step', id: call.id, view, status: 'error', detail: message });
      return fail(message);
    }
  }

  for (let steps = 0; steps < max; steps++) {
    if (isAborted(signal)) return stopped(steps);
    let res: AgentStep;
    try {
      res = await deps.step({ system: deps.system, history, tools: specs, signal, onText: (delta) => emit({ type: 'text', delta }) });
    } catch (e) {
      if (isAborted(signal)) return stopped(steps);
      return end('error', errorText(e), steps, e);
    }
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    emit({ type: 'usage', step: res.usage, total: { ...usage } });

    // A refusal can cut a tool call off mid-input: never run that turn's tools,
    // and leave the turn out of the history.
    if (res.stop === 'refusal') {
      return end('refusal', res.refusal?.trim() ? `The model declined to continue: ${res.refusal.trim()}` : 'The model declined to continue with this request.', steps + 1);
    }
    // Out of output tokens: a tool call in this turn may be truncated, so don't run it.
    if (res.stop === 'length') {
      if (res.toolCalls.length === 0 && res.text) history.push({ role: 'assistant', text: res.text, toolCalls: [], raw: res.raw });
      return end('length', "The model's reply hit its length limit before it finished. Ask it to continue, or to make a smaller change.", steps + 1);
    }

    history.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw });
    if (res.toolCalls.length === 0) return end('end', res.text.trim(), steps + 1);

    // Every call gets a result, in one message, even after Stop, so the history stays valid.
    const results: ToolResult[] = [];
    let summary: string | undefined;
    for (const call of res.toolCalls) {
      if (isAborted(signal)) {
        results.push({ id: call.id, content: 'The user stopped the run before this ran.', isError: true });
        continue;
      }
      const { result, finish } = await execute(call);
      results.push(result);
      if (finish !== undefined) summary = finish;
    }
    history.push({ role: 'tool', results });
    if (isAborted(signal)) return stopped(steps + 1);
    if (summary !== undefined) return end('finished', summary || 'Done.', steps + 1);
  }
  return end('max-steps', `Stopped after ${max} steps without finishing. Review what changed so far, or ask it to continue.`, max);
}

// ---------------------------------------------------------------------------
// The system prompt

export interface PromptContext {
  project: string;
  files: string[];
  // package.json scripts, when the project has one.
  scripts?: Record<string, string>;
}

const MAX_PROMPT_FILES = 150;

export function summarizeFiles(files: string[]): string {
  if (!files.length) return 'The project is empty.';
  const shown = files.slice(0, MAX_PROMPT_FILES).join('\n');
  const more = files.length - MAX_PROMPT_FILES;
  return `${files.length} file${files.length === 1 ? '' : 's'}:\n${shown}${more > 0 ? `\n…and ${more} more (use list_files).` : ''}`;
}

export function findTestCommand(ctx: PromptContext): string | null {
  const test = ctx.scripts?.test;
  if (test && !/no test specified/.test(test)) return 'npm test';
  const file = ctx.files.find((f) => /(^|\/)(test_[^/]+\.py|[^/]+_test\.py|[^/]+\.test\.[cm]?js|test\.[cm]?js)$/.test(f));
  if (!file) return null;
  return file.endsWith('.py') ? `python ${file}` : `node ${file}`;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const testCommand = findTestCommand(ctx);
  const scripts = ctx.scripts && Object.keys(ctx.scripts).length ? `\npackage.json scripts: ${Object.entries(ctx.scripts).map(([k, v]) => `${k} (${v})`).join('; ')}` : '';
  return `You are the coding agent inside Tide, a code editor for iPhone and iPad. You work on the user's project "${ctx.project}": read the code, make the change they ask for, check it, and finish with a short summary.

<project>
${summarizeFiles(ctx.files)}${scripts}
</project>

<runtime>
Commands run in Tide's Local terminal on the device. It is a small built-in shell, not bash: one command per run_command call, no pipes, no && chains, no shell scripts.
Available: ls, cat, echo, mkdir, rm, mv, cp, node <file>, python <file>, lua, ruby, php, npm install / npm run <script> / npm test / npx <installed bin>, pip install, git, sqlite3, env. Run help to see the full list.
There are no other binaries (no grep, sed, curl, make, gcc, pytest, tsc unless installed in node_modules). Use the search and read_file tools instead of shell commands to look at code. Packages with native code can't be installed.
</runtime>

<rules>
- Every edit you make is staged as a pending change. The user reviews each one as a diff and keeps or rejects it, so make small, focused edits that do only what was asked, and don't reformat code you aren't changing.
- Read a file before you edit it. Use edit_file for changes to existing files; old_text must match exactly once. Use write_file for new files.
- Paths are relative to the project root. You can't leave the project. When the user writes @path, they mean that project file.
- The user approves every command before it runs. Don't run commands you don't need; if one is denied, continue without it.
- ${testCommand ? `This project has tests: run \`${testCommand}\` after your change, and fix what you broke.` : 'If the project has tests, run them after your change. Don\'t add a test framework unless asked.'}
- Don't start servers or programs that wait for input; commands are stopped after 2 minutes.
- When the task is done, or you can't do it, call finish with a summary of what you changed and the test result. If something needs the user's decision, say so in the summary instead of guessing.
</rules>`;
}
