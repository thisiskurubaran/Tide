// Readable messages for what can go wrong talking to a provider, and the
// AiError kind each one is.
import Anthropic from '@anthropic-ai/sdk';

import { PROVIDERS } from './catalog';
import { AiError, ProviderId } from './types';

// A non-2xx answer from an OpenAI-style API.
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// The request never got an answer (offline, wrong address, server down).
export class ProviderNetworkError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly url: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof Anthropic.APIUserAbortError || (!!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError');
}

const SETTINGS = 'Check it in Settings, AI assistant.';

// Readable messages for the errors the APIs can give.
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return `Anthropic didn’t accept the API key. ${SETTINGS}`;
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key can’t use that model.';
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests for this API key right now. Try again in a minute.';
  if (e instanceof Anthropic.BadRequestError) return `Anthropic couldn’t take the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Couldn’t reach Anthropic. Check the connection.';
  if (e instanceof Anthropic.APIError) return `Anthropic answered with an error (${e.status ?? 'no status'}): ${e.message}`;
  if (e instanceof ProviderHttpError) {
    const name = PROVIDERS[e.provider].name;
    const detail = e.message ? `: ${e.message}` : '.';
    if (e.status === 401) return `${name} didn’t accept the API key. ${SETTINGS}`;
    if (e.status === 402) return `${name} says the account is out of credit${detail}`;
    if (e.status === 403) return `This API key can’t use that model${detail}`;
    if (e.status === 404) return `${name} doesn’t know that model or address${detail}`;
    if (e.status === 429) return `Too many requests for this API key right now, or the account is out of quota. Try again in a minute${detail}`;
    if (e.status === 400 || e.status === 422) return `${name} couldn’t take the request${detail}`;
    return `${name} answered with an error (${e.status})${detail}`;
  }
  if (e instanceof ProviderNetworkError) {
    return e.provider === 'custom'
      ? `Couldn’t reach your server at ${e.url}. Check that it’s running and that this device can reach it.`
      : `Couldn’t reach ${PROVIDERS[e.provider].name}. Check the connection.`;
  }
  return e instanceof Error ? e.message : String(e);
}

export function errorKind(e: unknown): AiError['kind'] {
  if (e instanceof AiError) return e.kind;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'auth';
  if (e instanceof Anthropic.RateLimitError) return 'rate';
  if (e instanceof Anthropic.APIConnectionError || e instanceof ProviderNetworkError) return 'network';
  if (e instanceof ProviderHttpError) return e.status === 401 || e.status === 403 ? 'auth' : e.status === 429 || e.status === 402 ? 'rate' : 'other';
  return 'other';
}

// Any provider error as an AiError; aborts are passed through as they are.
export function toAiError(e: unknown): unknown {
  if (e instanceof AiError || isAbort(e)) return e;
  const err = new AiError(describeError(e), errorKind(e));
  (err as { cause?: unknown }).cause = e;
  return err;
}
