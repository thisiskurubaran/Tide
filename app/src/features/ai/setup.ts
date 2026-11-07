// Connecting a provider: test the key (and address), keep it, and point any
// job that has no working provider yet at this one.
import { testProvider } from './client';
import { isClaudeModel, PROVIDER_ORDER, PROVIDERS } from './providers/catalog';
import type { AiJob, ProviderId } from './providers/types';
import { aiSettings, isConnected, removeProvider, setKey } from './settings';

const JOBS: AiJob[] = ['agent', 'chat', 'complete'];

export async function connectProvider(provider: ProviderId, key: string, baseUrl?: string): Promise<string[]> {
  const url = baseUrl?.trim() ?? '';
  if (provider === 'custom' && !url) throw new Error('Enter the server’s address, e.g. http://192.168.1.20:11434/v1');
  if (PROVIDERS[provider].keyRequired && !key.trim()) throw new Error('Paste an API key first.');
  const models = await testProvider(provider, key.trim() || null, url || PROVIDERS[provider].baseUrl || undefined);
  const s = aiSettings.getState();
  s.setBaseUrl(provider, url || null);
  if (provider !== 'anthropic') s.setKnownModels(provider, models);
  await setKey(provider, key);
  adoptJobs(provider, models);
  return models;
}

// Jobs whose provider isn't set up move to the newly connected one.
export function adoptJobs(provider: ProviderId, listed: string[] = []) {
  const s = aiSettings.getState();
  for (const job of JOBS) {
    const ref = s.jobs[job];
    if (isConnected(ref.provider) && ref.model.trim()) continue;
    const model = PROVIDERS[provider].models[job][0] ?? listed.find((m) => !isClaudeModel(m)) ?? '';
    if (model) s.setJob(job, { provider, model });
  }
}

// Forgets a provider; its jobs move to another connected one, if any.
export async function disconnectProvider(provider: ProviderId) {
  await removeProvider(provider);
  const other = PROVIDER_ORDER.find((p) => isConnected(p));
  if (other) adoptJobs(other, aiSettings.getState().knownModels[other]);
}
