// OpenAI, Gemini, OpenRouter and local servers (Ollama, LM Studio), through
// the OpenAI-style chat completions API: POST {baseUrl}/chat/completions.
// Requests go straight from the device to the server the user picked.
import { isClaudeModel } from './catalog';
import { isAbort, ProviderHttpError, ProviderNetworkError } from './errors';
import { stripThinking, thinkingFilter } from './text';
import { checkedCall } from './tools';
import type { AgentMessage, AgentStep, AgentStepRequest, AiJob, ChatRequest, ChatResult, ProviderId, StopReason, ToolCall, ToolSpec, Usage } from './types';

export interface OpenAiContext {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  fetch?: typeof fetch;
}

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  // Gemini's thought signatures and similar ride along and are sent back.
  [extra: string]: unknown;
}

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  [extra: string]: unknown;
}

// What the agent keeps of an assistant turn: the message as the server
// sent it, to send back unchanged.
export interface OpenAiRaw {
  provider: 'openai-compatible';
  message: WireMessage;
}

export const trimBase = (url: string) => url.trim().replace(/\/+$/, '');

function headers(ctx: Pick<OpenAiContext, 'apiKey' | 'provider'>): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}),
    ...(ctx.provider === 'openrouter' ? { 'x-title': 'Tide' } : {}),
  };
}

async function errorFrom(provider: ProviderId, res: Response): Promise<ProviderHttpError> {
  let message = '';
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text);
      const err = Array.isArray(body) ? body[0]?.error : body?.error;
      message = typeof err === 'string' ? err : (err?.message ?? body?.message ?? '');
    } catch {
      message = text.slice(0, 300);
    }
  } catch {
    // No body.
  }
  return new ProviderHttpError(provider, res.status, String(message).trim());
}

async function send(ctx: OpenAiContext, path: string, init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<Response> {
  const url = `${trimBase(ctx.baseUrl)}${path}`;
  let res: Response;
  try {
    res = await (ctx.fetch ?? fetch)(url, {
      method: init.method,
      headers: headers(ctx),
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: init.signal,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ProviderNetworkError(ctx.provider, trimBase(ctx.baseUrl), e);
  }
  if (!res.ok) throw await errorFrom(ctx.provider, res);
  return res;
}

// Reasoning models answer faster with less of it; only sent to models known
// to take the parameter, since others reject it.
const EFFORT: Record<AiJob, 'low' | 'medium' | 'high'> = { agent: 'high', chat: 'medium', complete: 'low' };
function effortParam(ctx: OpenAiContext, job: AiJob) {
  const m = ctx.model.replace(/^models\//, '');
  const reasoning = (ctx.provider === 'openai' && /^(gpt-5|o\d)/.test(m)) || (ctx.provider === 'gemini' && /^gemini-(2\.5|[3-9])/.test(m));
  return reasoning ? { reasoning_effort: EFFORT[job] } : {};
}

// OpenAI itself wants max_completion_tokens; everything else still takes max_tokens.
const maxTokensParam = (ctx: OpenAiContext, n: number) => (ctx.provider === 'openai' ? { max_completion_tokens: n } : { max_tokens: n });

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === 'object' && typeof p.text === 'string' ? p.text : '')).join('');
  return '';
}

function stopOf(finish: unknown): StopReason {
  return finish === 'tool_calls' || finish === 'function_call' ? 'tool_use' : finish === 'length' ? 'length' : finish === 'content_filter' ? 'refusal' : 'end';
}

function usageOf(u: unknown): Usage {
  const usage = (u ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  return { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 };
}

export function buildChatBody(ctx: OpenAiContext, req: ChatRequest) {
  return {
    model: ctx.model,
    messages: [{ role: 'system', content: req.system }, ...req.messages],
    ...maxTokensParam(ctx, req.maxTokens ?? 16000),
    ...effortParam(ctx, req.job),
  };
}

function assertNotClaude(ctx: OpenAiContext) {
  // Claude only ever goes through the official Anthropic SDK.
  if (isClaudeModel(ctx.model)) throw new ProviderHttpError(ctx.provider, 400, 'Claude models are used through the Anthropic provider. Add an Anthropic key and pick the model there.');
}

export async function openAiChat(ctx: OpenAiContext, req: ChatRequest): Promise<ChatResult> {
  assertNotClaude(ctx);
  const res = await send(ctx, '/chat/completions', { method: 'POST', body: buildChatBody(ctx, req), signal: req.signal });
  const body = await res.json();
  const choice = body?.choices?.[0];
  const usage = usageOf(body?.usage);
  const refusal = typeof choice?.message?.refusal === 'string' && choice.message.refusal ? choice.message.refusal : undefined;
  const stop = refusal ? 'refusal' : stopOf(choice?.finish_reason);
  if (stop === 'refusal') return { text: '', stop, refusal, usage };
  return { text: stripThinking(contentText(choice?.message?.content)).trim(), stop, usage };
}

function isOpenAiRaw(raw: unknown): raw is OpenAiRaw {
  return !!raw && typeof raw === 'object' && (raw as OpenAiRaw).provider === 'openai-compatible' && !!(raw as OpenAiRaw).message;
}

// The agent's history as chat messages. Assistant turns are replayed as the
// server sent them; one another provider wrote is rebuilt. Tool results
// become one `tool` message per call, as this API wants.
export function toOpenAiMessages(system: string, history: AgentMessage[]): WireMessage[] {
  const out: WireMessage[] = [{ role: 'system', content: system }];
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'tool') {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `Error: ${r.content}` : r.content });
    } else if (isOpenAiRaw(m.raw)) out.push(m.raw.message);
    else {
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
      });
    }
  }
  return out;
}

export const toOpenAiTools = (tools: ToolSpec[]) => tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

function parseArguments(tools: ToolSpec[], call: WireToolCall): ToolCall {
  const text = call.function?.arguments ?? '';
  let input: unknown;
  try {
    input = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { id: call.id, name: call.function?.name ?? '', input: { INVALID_JSON: text } };
  }
  return checkedCall(tools, call.id, call.function?.name ?? '', input, text);
}

// Server-sent events as lines, read as they arrive when the body streams
// (expo/fetch on device, Node in tests), or all at once when it doesn't.
async function* lines(res: Response): AsyncGenerator<string> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body || typeof body.getReader !== 'function' || typeof TextDecoder === 'undefined') {
    yield* (await res.text()).split(/\r?\n/);
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      yield* parts;
    }
    buffer += decoder.decode();
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock?.();
  }
}

interface StreamedTurn {
  message: WireMessage;
  finish: unknown;
  usage: Usage;
  refusal?: string;
}

// Accumulates a streamed answer: text deltas go to onText (without inline
// reasoning), tool call fragments are joined by index.
export async function readStream(provider: ProviderId, res: Response, onText?: (delta: string) => void): Promise<StreamedTurn> {
  // Some servers ignore `stream` and answer with one JSON body.
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await res.json();
    const choice = body?.choices?.[0];
    const message: WireMessage = { ...(choice?.message ?? {}), role: 'assistant', content: contentText(choice?.message?.content) || null };
    const text = stripThinking(message.content ?? '');
    if (text && onText) onText(text);
    return { message, finish: choice?.finish_reason, usage: usageOf(body?.usage), refusal: choice?.message?.refusal || undefined };
  }
  let content = '';
  let refusal = '';
  let finish: unknown = null;
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const calls: WireToolCall[] = [];
  const extras: Record<string, unknown> = {};
  const filter = thinkingFilter((t) => onText?.(t));
  for await (const line of lines(res)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk?.error) throw new ProviderHttpError(provider, Number(chunk.error.code) || 500, String(chunk.error.message ?? ''));
    if (chunk?.usage) usage = usageOf(chunk.usage);
    const choice = chunk?.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta ?? {};
    const text = contentText(delta.content);
    if (text) {
      content += text;
      filter.push(text);
    }
    if (typeof delta.refusal === 'string') refusal += delta.refusal;
    for (const [k, v] of Object.entries(delta)) {
      if (!['role', 'content', 'tool_calls', 'refusal', 'reasoning', 'reasoning_content', 'reasoning_details'].includes(k) && v != null) extras[k] = v;
    }
    for (const part of (delta.tool_calls ?? []) as any[]) {
      const i = typeof part.index === 'number' ? part.index : calls.length;
      const call = (calls[i] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (typeof part.function?.arguments === 'string') call.function.arguments += part.function.arguments;
      for (const [k, v] of Object.entries(part)) if (!['index', 'id', 'type', 'function'].includes(k)) call[k] = v;
    }
  }
  filter.flush();
  const toolCalls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  const message: WireMessage = { ...extras, role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  return { message, finish, usage, refusal: refusal || undefined };
}

export function buildAgentBody(ctx: OpenAiContext, req: AgentStepRequest) {
  return {
    model: ctx.model,
    messages: toOpenAiMessages(req.system, req.history),
    ...(req.tools.length ? { tools: toOpenAiTools(req.tools) } : {}),
    ...maxTokensParam(ctx, 32000),
    ...effortParam(ctx, 'agent'),
    stream: true,
    stream_options: { include_usage: true },
  };
}

export async function openAiAgentStep(ctx: OpenAiContext, req: AgentStepRequest): Promise<AgentStep> {
  assertNotClaude(ctx);
  const res = await send(ctx, '/chat/completions', { method: 'POST', body: buildAgentBody(ctx, req), signal: req.signal });
  const turn = await readStream(ctx.provider, res, req.onText);
  const stop: StopReason = turn.refusal ? 'refusal' : stopOf(turn.finish);
  const wireCalls = turn.message.tool_calls ?? [];
  const text = stripThinking(turn.message.content ?? '').trim();
  // A refused or cut-off turn's tool calls never run, and aren't replayed.
  if (stop === 'refusal' || (stop === 'length' && wireCalls.length)) {
    const { tool_calls: _dropped, ...message } = turn.message;
    return { text: stop === 'refusal' ? '' : text, toolCalls: [], stop, ...(turn.refusal ? { refusal: turn.refusal } : {}), usage: turn.usage, raw: { provider: 'openai-compatible', message } satisfies OpenAiRaw };
  }
  // Some servers say "stop" even when they called tools.
  return {
    text,
    toolCalls: wireCalls.map((c) => parseArguments(req.tools, c)),
    stop: wireCalls.length ? 'tool_use' : stop,
    usage: turn.usage,
    raw: { provider: 'openai-compatible', message: turn.message } satisfies OpenAiRaw,
  };
}

// Checks the key (and address) and returns the models the server offers.
export async function testOpenAiKey(ctx: Omit<OpenAiContext, 'model'>): Promise<string[]> {
  const c = { ...ctx, model: '' };
  // OpenRouter lists models without a key, so the key is checked on its own.
  if (ctx.provider === 'openrouter') await send(c, '/key', { method: 'GET' });
  const res = await send(c, '/models', { method: 'GET' });
  const body = await res.json().catch(() => null);
  const list: unknown[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return list
    .map((m) => (m && typeof m === 'object' ? String((m as { id?: string; name?: string }).id ?? (m as { name?: string }).name ?? '') : ''))
    .map((id) => id.replace(/^models\//, ''))
    .filter((id) => id && !isClaudeModel(id))
    .slice(0, 400);
}
