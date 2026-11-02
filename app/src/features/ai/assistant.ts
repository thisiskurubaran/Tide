// The AI assistant: explains, fixes or changes the open file with
// Claude, through the official Anthropic SDK and the user's own API key. The
// request goes straight from the device to Anthropic; Tide has no server.
import Anthropic from '@anthropic-ai/sdk';

export type AiModel = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5';

export const MODELS: { id: AiModel; label: string; detail: string }[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', detail: 'Most capable' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', detail: 'Faster, lower cost' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', detail: 'Fastest, lowest cost' },
];
export const DEFAULT_MODEL: AiModel = 'claude-opus-5-5';

export type AiTask = { kind: 'explain' } | { kind: 'fix' } | { kind: 'ask'; prompt: string };

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
        : task.prompt;
  return `<file path="${file.path}">\n${file.content}\n</file>${focus}\n\n${ask}`;
}

// The last fenced block, when the reply rewrites the file.
export function extractCode(text: string): string | null {
  const blocks = [...text.matchAll(/```[^\n`]*\n([\s\S]*?)\n?```/g)];
  return blocks.length ? blocks[blocks.length - 1][1] : null;
}

export class AiError extends Error {}

// Readable messages for the errors the API can give.
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic didn’t accept the API key. Check it in Settings, AI assistant.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key can’t use that model.';
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests for this API key right now. Try again in a minute.';
  if (e instanceof Anthropic.BadRequestError) return `Anthropic couldn’t take the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Anthropic. Check the connection.';
  if (e instanceof Anthropic.APIError) return `Anthropic answered with an error (${e.status ?? 'no status'}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export function createClient(apiKey: string, fetchImpl?: typeof fetch): Anthropic {
  // The key is the user's own and stays on their device, so running "in a
  // browser" (the web build) exposes nothing that isn't already theirs.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

export async function runTask(client: Anthropic, model: AiModel, task: AiTask, file: AiFile): Promise<AiAnswer> {
  if (file.content.length > MAX_FILE_CHARS) throw new AiError(`This file is too big to send (${Math.round(file.content.length / 1000)}k characters). Select the part you want help with instead.`);
  // Opus and Sonnet can hand a declined request to another model server-side.
  const fallback = model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  const message = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt(task, file) }],
    ...fallback,
  });
  if (message.stop_reason === 'refusal') {
    throw new AiError(`Claude declined this request${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`);
  }
  const text = message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const truncated = message.stop_reason === 'max_tokens' ? '\n\n_The answer was cut off at the length limit._' : '';
  // A cut-off answer's code block may be incomplete, so it isn't offered to apply.
  return { text: text + truncated, code: task.kind === 'explain' || truncated ? null : extractCode(text) };
}
