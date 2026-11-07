// Claude, through the official Anthropic SDK and the user's own key. The
// request goes straight from the device to Anthropic.
import Anthropic from '@anthropic-ai/sdk';

import { checkedCall } from './tools';
import type { AgentMessage, AgentStep, AgentStepRequest, AiJob, ChatRequest, ChatResult, StopReason, ToolSpec, Usage } from './types';

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type BetaToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type BetaTextBlock = Anthropic.Beta.BetaTextBlock;

export interface AnthropicContext {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

// What the agent keeps of an assistant turn: Claude's own content blocks,
// thinking included, to send back unchanged.
export interface AnthropicRaw {
  provider: 'anthropic';
  content: BetaContentBlockParam[];
}

export function createClient(apiKey: string, fetchImpl?: typeof fetch): Anthropic {
  // The key is the user's own and stays on their device, so running "in a
  // browser" (the web build) exposes nothing that isn't already theirs.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

// How hard to think, per job. Claude Opus 5.5 and Sonnet 5.5 think
// adaptively whatever `thinking` says, so effort is the only dial; it's
// sent for the 5.x models, which all take it.
const EFFORT: Record<AiJob, 'low' | 'medium' | 'high'> = { agent: 'high', chat: 'medium', complete: 'low' };

function modelParams(model: string, job: AiJob) {
  const effort = /^claude-(opus|sonnet|haiku)-5/.test(model) ? { output_config: { effort: EFFORT[job] } } : {};
  // Opus and Sonnet can hand a declined request to another model server-side.
  const fallback = /haiku/.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  return { ...effort, ...fallback };
}

// Input counted at what it's billed as: cache writes at 1.25x and cache
// reads at 0.1x the input price, so the spend estimate and the monthly limit
// follow the real bill when agent turns hit the cache.
const usageOf = (m: BetaMessage): Usage => ({
  inputTokens: Math.round((m.usage.input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0) * 1.25 + (m.usage.cache_read_input_tokens ?? 0) * 0.1),
  outputTokens: m.usage.output_tokens ?? 0,
});

const stopOf = (m: BetaMessage): StopReason => (m.stop_reason === 'tool_use' ? 'tool_use' : m.stop_reason === 'max_tokens' || m.stop_reason === 'model_context_window_exceeded' ? 'length' : m.stop_reason === 'refusal' ? 'refusal' : 'end');

const textOf = (m: BetaMessage) =>
  m.content
    .filter((b): b is BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

export interface Served<T> {
  result: T;
  // The model that answered (a server-side fallback may differ), for pricing.
  model: string;
}

export async function anthropicChat(ctx: AnthropicContext, req: ChatRequest): Promise<Served<ChatResult>> {
  const client = createClient(ctx.apiKey, ctx.fetch);
  const message = await client.beta.messages.create(
    {
      model: ctx.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: req.messages,
      ...modelParams(ctx.model, req.job),
    },
    { signal: req.signal },
  );
  const usage = usageOf(message);
  // A refused answer's content isn't read.
  if (message.stop_reason === 'refusal') {
    return { model: message.model, result: { text: '', stop: 'refusal', refusal: message.stop_details?.explanation ?? undefined, usage } };
  }
  return { model: message.model, result: { text: textOf(message), stop: stopOf(message), usage } };
}

function isAnthropicRaw(raw: unknown): raw is AnthropicRaw {
  return !!raw && typeof raw === 'object' && (raw as AnthropicRaw).provider === 'anthropic' && Array.isArray((raw as AnthropicRaw).content);
}

// The agent's history as Claude messages. Assistant turns are replayed from
// their raw content; a turn another provider wrote is rebuilt from its text
// and tool calls. Results for one turn's tool calls go in one user message.
export function toAnthropicMessages(history: AgentMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })),
      });
    } else {
      const content: BetaContentBlockParam[] = isAnthropicRaw(m.raw)
        ? m.raw.content
        : [
            ...(m.text.trim() ? [{ type: 'text' as const, text: m.text }] : []),
            ...m.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: (c.input ?? {}) as Record<string, unknown> })),
          ];
      if (content.length) out.push({ role: 'assistant', content });
    }
  }
  return out;
}

export function toAnthropicTools(tools: ToolSpec[]): Anthropic.Beta.BetaTool[] {
  // Streamed requests stream tool input as it's generated; the input is
  // then checked here (tools.ts) instead of by the server.
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema, eager_input_streaming: true }));
}

// How many times a turn whose tool input wasn't JSON at all is re-sent.
const JSON_RETRIES = 2;

export async function anthropicAgentStep(ctx: AnthropicContext, req: AgentStepRequest): Promise<Served<AgentStep>> {
  const client = createClient(ctx.apiKey, ctx.fetch);
  const params = {
    model: ctx.model,
    max_tokens: 32000,
    system: req.system,
    messages: toAnthropicMessages(req.history),
    tools: toAnthropicTools(req.tools),
    // Each agent step resends the whole conversation; caching it makes the
    // repeated prefix cost a tenth of the input price.
    cache_control: { type: 'ephemeral' as const },
    ...modelParams(ctx.model, 'agent'),
  };
  let message: BetaMessage;
  for (let attempt = 0; ; attempt++) {
    const stream = client.beta.messages.stream(params, { signal: req.signal });
    if (req.onText) stream.on('text', (delta) => req.onText?.(delta));
    try {
      // finalMessage() rejects if a streamed tool input couldn't be parsed
      // at all; only that is retried, API errors (aborts too) are not.
      message = await stream.finalMessage();
      break;
    } catch (e) {
      if (e instanceof Anthropic.APIError || attempt >= JSON_RETRIES) throw e;
    }
  }
  const usage = usageOf(message);
  const toolUses = message.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
  // A refusal can cut a tool call off mid-input, and so can the length
  // limit: that turn's tools never run, and its tool calls are left out of
  // what's replayed so the conversation can go on.
  if (message.stop_reason === 'refusal' || (message.stop_reason === 'max_tokens' && toolUses.length)) {
    const content = message.content.filter((b) => b.type !== 'tool_use') as BetaContentBlockParam[];
    const refusal = message.stop_reason === 'refusal';
    return {
      model: message.model,
      result: {
        text: refusal ? '' : textOf(message),
        toolCalls: [],
        stop: refusal ? 'refusal' : 'length',
        ...(refusal ? { refusal: message.stop_details?.explanation ?? undefined } : {}),
        usage,
        raw: { provider: 'anthropic', content } satisfies AnthropicRaw,
      },
    };
  }
  return {
    model: message.model,
    result: {
      text: textOf(message),
      toolCalls: toolUses.map((b) => checkedCall(req.tools, b.id, b.name, b.input)),
      stop: stopOf(message),
      usage,
      raw: { provider: 'anthropic', content: message.content as BetaContentBlockParam[] } satisfies AnthropicRaw,
    },
  };
}

// A cheap call that fails if the key is wrong.
export async function testAnthropicKey(apiKey: string, fetchImpl?: typeof fetch): Promise<string[]> {
  const page = await createClient(apiKey, fetchImpl).models.list({ limit: 20 });
  return page.data.map((m) => m.id);
}
