// The AI assistant: explains, fixes or changes the open file with the
// model picked for the chat job (Claude through the official Anthropic SDK,
// or an OpenAI-style provider) and the user's own key. The request goes
// straight from the device to the provider; Tide has no server.
import { chat } from './client';
import { modelLabel, PROVIDERS } from './providers/catalog';
import { AiError } from './providers/types';
import { aiSettings } from './settings';

export { AiError } from './providers/types';
export { describeError } from './providers/errors';
export { createClient } from './providers/anthropic';

export type AiModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export const MODELS: { id: AiModel; label: string; detail: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', detail: 'Most capable' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', detail: 'Faster, lower cost' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', detail: 'Fastest, lowest cost' },
];
export const DEFAULT_MODEL: AiModel = 'claude-opus-5-5';

export type AiTask = { kind: 'explain' } | { kind: 'fix' } | { kind: 'ask'; prompt: string } | { kind: 'error'; output: string };

// Enough of a program's output to show the error and what led to it.
export const MAX_OUTPUT_CHARS = 6000;

export interface AiFile {
  path: string;
  content: string;
  // The editor's selection, when there is one, to focus on.
  selection?: string;
}

export interface AiAnswer {
  // Markdown, for showing.
  text: string;
  // The whole file as the model rewrote it, when it did.
  code: string | null;
}

// Files are sent whole; this keeps a request well inside the context window.
export const MAX_FILE_CHARS = 400_000;

const SYSTEM = `You are the coding assistant in Tide, a code editor for iPhone and iPad. The user is looking at one file from their project.

When you change code, reply with the complete updated file in a single fenced code block, then a short list of what you changed and why. Keep everything else in the file as it was. When you only explain or answer, don't rewrite the file. Be concise: the screen is small.`;

function prompt(task: AiTask, file: AiFile): string {
  const focus = file.selection ? `\n\nThe user selected this part:\n\n<selection>\n${file.selection}\n</selection>` : '';
  const ask =
    task.kind === 'explain'
      ? `Explain what ${file.selection ? 'the selected code' : 'this file'} does and how it works, for someone about to change it.`
      : task.kind === 'fix'
        ? `Find bugs in ${file.selection ? 'the selected code' : 'this file'} and fix them. If there's nothing to fix, say so and don't rewrite the file.`
        : task.kind === 'error'
          ? `Running the project printed this error:\n\n<output>\n${task.output.slice(-MAX_OUTPUT_CHARS)}\n</output>\n\nExplain in plain words what went wrong and why, pointing at the line in this file that causes it. If the file needs a change, give the fix as the complete updated file. If the cause is elsewhere (another file, a missing package, the environment), say what to do instead and don't rewrite the file.`
          : task.prompt;
  return `<file path="${file.path}">\n${file.content}\n</file>${focus}\n\n${ask}`;
}

// The last fenced block, when the reply rewrites the file.
export function extractCode(text: string): string | null {
  const blocks = [...text.matchAll(/```[^\n`]*\n([\s\S]*?)\n?```/g)];
  return blocks.length ? blocks[blocks.length - 1][1] : null;
}

// Who answered, for messages: "Claude" for Anthropic, else the model.
function modelName(): string {
  const ref = aiSettings.getState().jobs.chat;
  return ref.provider === 'anthropic' ? 'Claude' : modelLabel(ref.model) || PROVIDERS[ref.provider].name;
}

export async function runTask(task: AiTask, file: AiFile, signal?: AbortSignal): Promise<AiAnswer> {
  if (file.content.length > MAX_FILE_CHARS) throw new AiError(`This file is too big to send (${Math.round(file.content.length / 1000)}k characters). Select the part you want help with instead.`);
  const result = await chat({ job: 'chat', system: SYSTEM, messages: [{ role: 'user', content: prompt(task, file) }], maxTokens: 16000, signal });
  if (result.stop === 'refusal') {
    throw new AiError(`${modelName()} declined this request${result.refusal ? `: ${result.refusal}` : '.'}`, 'refusal');
  }
  const truncated = result.stop === 'length' ? '\n\n_The answer was cut off at the length limit._' : '';
  // A cut-off answer's code block may be incomplete, so it isn't offered to apply.
  return { text: result.text + truncated, code: task.kind === 'explain' || truncated ? null : extractCode(result.text) };
}

// The line that names the error, for showing above the button.
export function lastErrorLine(output: string): string {
  const lines = output.trimEnd().split('\n');
  const named = [...lines].reverse().find((l) => /\b\w*(Error|Exception)\b|error\b|failed/i.test(l) && !/^\s+at /.test(l));
  return (named ?? lines[lines.length - 1] ?? '').trim();
}
