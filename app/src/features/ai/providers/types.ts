// The provider-neutral shape every AI feature in Tide talks to. Anthropic
// goes through the official SDK; OpenAI, Gemini, OpenRouter and local
// servers (Ollama, LM Studio) go through their OpenAI-style chat API. Keys
// are the user's own, in the Keychain, and requests go straight from the
// device to the provider.

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';

// Each job can use its own model: a capable one for the agent, a fast one
// for completions.
export type AiJob = 'agent' | 'chat' | 'complete';

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = 'end' | 'tool_use' | 'length' | 'refusal';

// One-shot requests: explain, fix, commit messages, completions.
export interface ChatRequest {
  job: AiJob;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  stop: StopReason;
  // Set when the provider declined, e.g. Anthropic's refusal explanation.
  refusal?: string;
  usage: Usage;
}

// Tools for the agent, as JSON Schema.
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

// The agent's conversation. `raw` keeps the provider's own content for an
// assistant turn (Anthropic thinking blocks must be sent back unchanged), so
// history is replayed exactly and only ever appended to.
export type AgentMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw: unknown }
  | { role: 'tool'; results: ToolResult[] };

export interface AgentStepRequest {
  system: string;
  history: AgentMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
  // Called with text as it streams in, for showing progress.
  onText?(delta: string): void;
}

export interface AgentStep {
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  refusal?: string;
  usage: Usage;
  raw: unknown;
}

// Inline completion at the cursor.
export interface CompletionRequest {
  path: string;
  language: string;
  prefix: string;
  suffix: string;
  signal?: AbortSignal;
}

// Thrown for anything the user should read: no key, spend limit reached,
// provider errors (with a readable message).
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: 'no-key' | 'limit' | 'auth' | 'rate' | 'network' | 'refusal' | 'other' = 'other',
  ) {
    super(message);
  }
}
