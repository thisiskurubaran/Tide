// The providers Tide can talk to, with what the settings screen shows for
// each: where to get a key, the default address and a few suggested models
// per job. Any model name can be typed in as well; suggestions are only a
// starting point, since providers add models all the time.
import type { AiJob, ModelRef, ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  // The letter on the badge, and its color.
  letter: string;
  color: string | null;
  // The OpenAI-style base URL ('' for Anthropic, which uses its own SDK).
  baseUrl: string;
  keyRequired: boolean;
  keyPlaceholder: string;
  keyHelp: string;
  keyUrl: string | null;
  // Suggested models per job, best first.
  models: Record<AiJob, string[]>;
  // A short line under the name in the provider list.
  blurb: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    letter: 'A',
    color: '#d97757',
    baseUrl: '',
    keyRequired: true,
    keyPlaceholder: 'sk-ant-…',
    keyHelp: 'Create a key in the Anthropic Console, under Settings, API keys.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    models: {
      agent: ['claude-opus-5-5', 'claude-sonnet-5-5'],
      chat: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
      complete: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    },
    blurb: 'Claude: recommended for the agent',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    letter: 'O',
    color: '#10a37f',
    baseUrl: 'https://api.openai.com/v1',
    keyRequired: true,
    keyPlaceholder: 'sk-…',
    keyHelp: 'Create a key at platform.openai.com, under API keys.',
    keyUrl: 'https://platform.openai.com/api-keys',
    models: {
      agent: ['gpt-5', 'gpt-5-mini'],
      chat: ['gpt-5-mini', 'gpt-5'],
      complete: ['gpt-5-nano', 'gpt-5-mini'],
    },
    blurb: 'GPT models',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    letter: 'G',
    color: '#4285f4',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyRequired: true,
    keyPlaceholder: 'AIza…',
    keyHelp: 'Create a key in Google AI Studio, under Get API key.',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: {
      agent: ['gemini-2.5-pro', 'gemini-2.5-flash'],
      chat: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      complete: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
    },
    blurb: 'Through its OpenAI-compatible API',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    letter: 'R',
    color: '#6c5ce7',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyRequired: true,
    keyPlaceholder: 'sk-or-…',
    keyHelp: 'Create a key at openrouter.ai, under Keys.',
    keyUrl: 'https://openrouter.ai/keys',
    models: {
      agent: ['qwen/qwen3-coder', 'deepseek/deepseek-chat'],
      chat: ['deepseek/deepseek-chat', 'qwen/qwen3-coder'],
      complete: ['mistralai/codestral-2508', 'qwen/qwen3-coder'],
    },
    blurb: 'Many open models with one key',
  },
  custom: {
    id: 'custom',
    name: 'Your own server',
    letter: '~',
    color: null,
    baseUrl: '',
    keyRequired: false,
    keyPlaceholder: 'Optional',
    keyHelp: 'Any OpenAI-compatible server: Ollama (http://<computer>:11434/v1), LM Studio (http://<computer>:1234/v1) or a hosted one. A key is only needed if the server asks for one.',
    keyUrl: null,
    models: { agent: [], chat: [], complete: [] },
    blurb: 'Ollama, LM Studio or any OpenAI-compatible URL',
  },
};

export const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'gemini', 'openrouter', 'custom'];

export const DEFAULT_JOBS: Record<AiJob, ModelRef> = {
  agent: { provider: 'anthropic', model: 'claude-opus-5-5' },
  chat: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  complete: { provider: 'anthropic', model: 'claude-haiku-5-5' },
};

export const JOB_LABELS: Record<AiJob, string> = {
  agent: 'Agent',
  chat: 'Chat, explain and fix',
  complete: 'Inline completions',
};

// Friendly names for the models Tide knows; anything else shows as typed.
const MODEL_LABELS: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

export const modelLabel = (model: string) => MODEL_LABELS[model] ?? model;

// Claude only goes through the official Anthropic SDK, never through an
// OpenAI-style gateway, so Claude names are turned away on other providers.
export function isClaudeModel(model: string): boolean {
  return /(^|\/)claude[-_]/i.test(model.trim()) || /^anthropic\//i.test(model.trim());
}
