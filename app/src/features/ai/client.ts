// Entry points every AI feature uses. Each one picks the model configured
// for its job, reads that provider's key, checks the monthly spend limit,
// sends the request and records the usage.
//
// Implemented in providers/ (anthropic.ts uses the official SDK;
// openaiCompatible.ts speaks the OpenAI-style chat API).
import { anthropicAgentStep, anthropicChat, testAnthropicKey } from './providers/anthropic';
import { PROVIDERS } from './providers/catalog';
import { toAiError } from './providers/errors';
import { openAiAgentStep, openAiChat, testOpenAiKey } from './providers/openaiCompatible';
import { cleanCompletion, head, tail } from './providers/text';
import { AiError } from './providers/types';
import type { AgentStep, AgentStepRequest, AiJob, ChatRequest, ChatResult, CompletionRequest, ModelRef, ProviderId, Usage } from './providers/types';
import { aiSettings, baseUrlFor, getKey, isConnected, refreshKeys } from './settings';
import { formatUsd, overLimit, usageStore } from './usage';

export { AiError } from './providers/types';
export type * from './providers/types';
export { describeError } from './providers/errors';
export { isInvalidToolInput, validateToolInput } from './providers/tools';

interface Target {
  ref: ModelRef;
  apiKey: string | null;
  baseUrl: string;
}

async function target(job: AiJob): Promise<Target> {
  const s = aiSettings.getState();
  const ref = s.jobs[job];
  const info = PROVIDERS[ref.provider];
  const apiKey = await getKey(ref.provider);
  const baseUrl = baseUrlFor(ref.provider);
  if (ref.provider === 'custom' ? !baseUrl : !apiKey) {
    throw new AiError(ref.provider === 'custom' ? 'Add your server’s address in Settings, AI assistant.' : `Add your ${info.name} API key in Settings, AI assistant.`, 'no-key');
  }
  if (!ref.model.trim()) throw new AiError('Pick a model in Settings, AI assistant.', 'no-key');
  const limit = s.monthlyLimitUsd;
  if (overLimit(limit)) {
    throw new AiError(`This month’s AI spending has reached your limit of ${formatUsd(limit ?? 0)}. Raise it in Settings, AI assistant.`, 'limit');
  }
  return { ref, apiKey, baseUrl };
}

function record(provider: ProviderId, model: string, usage: Usage) {
  if (usage.inputTokens || usage.outputTokens) usageStore.getState().record(provider, model, usage);
}

async function chatWith(t: Target, req: ChatRequest): Promise<ChatResult> {
  try {
    if (t.ref.provider === 'anthropic') {
      const { result, model } = await anthropicChat({ apiKey: t.apiKey ?? '', model: t.ref.model }, req);
      record('anthropic', model, result.usage);
      return result;
    }
    const result = await openAiChat({ provider: t.ref.provider, baseUrl: t.baseUrl, apiKey: t.apiKey, model: t.ref.model }, req);
    record(t.ref.provider, t.ref.model, result.usage);
    return result;
  } catch (e) {
    throw toAiError(e);
  }
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  return chatWith(await target(req.job), req);
}

export async function agentStep(req: AgentStepRequest): Promise<AgentStep> {
  const t = await target('agent');
  try {
    if (t.ref.provider === 'anthropic') {
      const { result, model } = await anthropicAgentStep({ apiKey: t.apiKey ?? '', model: t.ref.model }, req);
      record('anthropic', model, result.usage);
      return result;
    }
    const result = await openAiAgentStep({ provider: t.ref.provider, baseUrl: t.baseUrl, apiKey: t.apiKey, model: t.ref.model }, req);
    record(t.ref.provider, t.ref.model, result.usage);
    return result;
  } catch (e) {
    throw toAiError(e);
  }
}

// How much of the file around the cursor goes with a completion request.
export const COMPLETION_PREFIX_CHARS = 4000;
export const COMPLETION_SUFFIX_CHARS = 1000;
// Room for the inserted text, and for a little reasoning on models that
// think first (it counts toward the same limit).
const COMPLETION_MAX_TOKENS = 256;

const COMPLETE_SYSTEM = `You are the inline code completion engine in Tide, a code editor. You get a file with the cursor marked as <CURSOR/>. Reply with only the text to insert at the cursor: no explanation, no code fences, and none of the code that is already before or after the cursor. Insert at most a few lines that finish the current statement or block the way the author most likely would. If there's nothing useful to insert, reply with nothing.`;

export function completionPrompt(req: CompletionRequest): string {
  const before = tail(req.prefix, COMPLETION_PREFIX_CHARS);
  const after = head(req.suffix, COMPLETION_SUFFIX_CHARS);
  return `<file path="${req.path}" language="${req.language}">\n${before}<CURSOR/>${after}\n</file>`;
}

// The text to insert at the cursor, or '' for nothing useful. Quiet by
// design: with completions off, nothing set up, or the spend limit
// reached, it returns '' instead of throwing. Provider errors still throw
// (as AiError), and aborts as they are.
export async function complete(req: CompletionRequest): Promise<string> {
  if (!aiSettings.getState().completions) return '';
  let t: Target;
  try {
    t = await target('complete');
  } catch {
    return '';
  }
  const result = await chatWith(t, {
    job: 'complete',
    system: COMPLETE_SYSTEM,
    messages: [{ role: 'user', content: completionPrompt(req) }],
    maxTokens: COMPLETION_MAX_TOKENS,
    signal: req.signal,
  });
  if (result.stop === 'refusal' || !result.text) return '';
  return cleanCompletion(result.text, req.prefix, req.suffix);
}

// Whether the job has a provider with a key (or a local server) set up.
export function aiReady(job: AiJob): boolean {
  const s = aiSettings.getState();
  if (s.hasKey === null) refreshKeys();
  const ref = s.jobs[job];
  return isConnected(ref.provider, s) && !!ref.model.trim();
}

// Checks a key (and address) with a cheap request, and returns the models
// the provider lists. Throws AiError with a readable message.
export async function testProvider(provider: ProviderId, apiKey: string | null, baseUrl?: string): Promise<string[]> {
  try {
    if (provider === 'anthropic') return await testAnthropicKey(apiKey ?? '');
    const url = baseUrl?.trim() || baseUrlFor(provider);
    if (!url) throw new AiError('Enter the server’s address first.', 'no-key');
    return await testOpenAiKey({ provider, baseUrl: url, apiKey });
  } catch (e) {
    throw toAiError(e);
  }
}
