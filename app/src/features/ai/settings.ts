// The AI settings: one API key per provider, kept in the Keychain; the
// model for each job; whether inline completions are on; and the monthly
// spend limit. Only the keys are secret; the rest is a persisted store.
import * as SecureStore from 'expo-secure-store';
import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { storage } from '../../state';
import { DEFAULT_JOBS, PROVIDER_ORDER, PROVIDERS } from './providers/catalog';
import type { AiJob, ModelRef, ProviderId } from './providers/types';
import { hydrated } from '../../state/hydrated';

// One Keychain entry per provider. The Anthropic one keeps the name Tide
// used when it only had Anthropic, so existing keys carry over as they are.
export const keyName = (provider: ProviderId) => `tide.ai.${provider}-key`;

export const DEFAULT_LIMIT_USD = 10;

export interface AiSettings {
  jobs: Record<AiJob, ModelRef>;
  // Inline completions while typing, once a provider is set up.
  completions: boolean;
  // Estimated dollars per calendar month; null for no limit.
  monthlyLimitUsd: number | null;
  // Base URL overrides; required for 'custom'.
  baseUrls: Partial<Record<ProviderId, string>>;
  // Models the provider listed when its key was last tested.
  knownModels: Partial<Record<ProviderId, string[]>>;
  // Which providers are set up (a key saved, or a server address for
  // 'custom'). Not secret, so aiReady() can answer without the Keychain.
  connected: Partial<Record<ProviderId, boolean>>;
  // Whether any provider is set up; null until the Keychain was read.
  hasKey: boolean | null;
  setJob(job: AiJob, ref: ModelRef): void;
  setCompletions(on: boolean): void;
  setMonthlyLimit(usd: number | null): void;
  setBaseUrl(provider: ProviderId, url: string | null): void;
  setKnownModels(provider: ProviderId, models: string[]): void;
}

type Persisted = Pick<AiSettings, 'jobs' | 'completions' | 'monthlyLimitUsd' | 'baseUrls' | 'knownModels' | 'connected'>;

export const DEFAULTS: Persisted = {
  jobs: DEFAULT_JOBS,
  completions: true,
  monthlyLimitUsd: DEFAULT_LIMIT_USD,
  baseUrls: {},
  knownModels: {},
  connected: {},
};

const anyConnected = (connected: Partial<Record<ProviderId, boolean>>) => PROVIDER_ORDER.some((p) => connected[p]);

// Version 1 had one Anthropic model for everything; it becomes the chat model.
export function migrateAiSettings(persisted: unknown, version: number): Persisted {
  const old = (persisted ?? {}) as Partial<Persisted> & { model?: string };
  if (version < 2) {
    return { ...DEFAULTS, jobs: { ...DEFAULT_JOBS, chat: { provider: 'anthropic', model: old.model || DEFAULT_JOBS.chat.model } } };
  }
  return { ...DEFAULTS, ...old, jobs: { ...DEFAULT_JOBS, ...old.jobs } };
}

export function createAiSettingsStore(store: StateStorage<Promise<void>> | StateStorage) {
  return createStore<AiSettings>()(
    persist(
      (set) => ({
        ...DEFAULTS,
        hasKey: null,
        setJob: (job, ref) => set((s) => ({ jobs: { ...s.jobs, [job]: { provider: ref.provider, model: ref.model.trim() } } })),
        setCompletions: (completions) => set({ completions }),
        setMonthlyLimit: (usd) => set({ monthlyLimitUsd: usd === null || !Number.isFinite(usd) || usd < 0 ? null : Math.round(usd * 100) / 100 }),
        setBaseUrl: (provider, url) =>
          set((s) => {
            const baseUrls = { ...s.baseUrls };
            if (url && url.trim()) baseUrls[provider] = url.trim();
            else delete baseUrls[provider];
            return { baseUrls };
          }),
        setKnownModels: (provider, models) => set((s) => ({ knownModels: { ...s.knownModels, [provider]: models } })),
      }),
      {
        name: 'ai',
        version: 2,
        storage: createJSONStorage(() => store),
        migrate: migrateAiSettings,
        partialize: ({ jobs, completions, monthlyLimitUsd, baseUrls, knownModels, connected }) => ({ jobs, completions, monthlyLimitUsd, baseUrls, knownModels, connected }),
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<Persisted>;
          const merged = { ...current, ...p, jobs: { ...DEFAULT_JOBS, ...p.jobs } };
          return { ...merged, hasKey: current.hasKey ?? (anyConnected(merged.connected) ? true : null) };
        },
      },
    ),
  );
}

export const aiSettings = createAiSettingsStore(storage);

export function getKey(provider: ProviderId): Promise<string | null> {
  return SecureStore.getItemAsync(keyName(provider)).catch(() => null);
}

function markConnected(provider: ProviderId, on: boolean) {
  const connected = { ...aiSettings.getState().connected, [provider]: on };
  if (!on) delete connected[provider];
  aiSettings.setState({ connected, hasKey: anyConnected(connected) });
}

// Saves (or, with '', removes) a provider's key. For 'custom' the server
// address is what sets it up; its key is optional.
export async function setKey(provider: ProviderId, value: string): Promise<void> {
  const key = value.trim();
  if (key) await SecureStore.setItemAsync(keyName(provider), key);
  else await SecureStore.deleteItemAsync(keyName(provider)).catch(() => undefined);
  markConnected(provider, provider === 'custom' ? !!aiSettings.getState().baseUrls.custom : !!key);
}

// Forgets a provider: its key, and for 'custom' the address too.
export async function removeProvider(provider: ProviderId): Promise<void> {
  await SecureStore.deleteItemAsync(keyName(provider)).catch(() => undefined);
  if (provider === 'custom') aiSettings.getState().setBaseUrl('custom', null);
  markConnected(provider, false);
}

// The address requests go to: the user's override, or the provider's own.
export function baseUrlFor(provider: ProviderId, state: Pick<AiSettings, 'baseUrls'> = aiSettings.getState()): string {
  return state.baseUrls[provider]?.trim() || PROVIDERS[provider].baseUrl;
}

export function isConnected(provider: ProviderId, state: Pick<AiSettings, 'connected'> = aiSettings.getState()): boolean {
  return !!state.connected[provider];
}

let checking: Promise<void> | null = null;

// Reads which providers have a key in the Keychain, once per launch (and
// again after a change), so the flags match what's really there.
export function refreshKeys(force = false): Promise<void> {
  if (checking && !force) return checking;
  checking = (async () => {
    // The custom server's address comes from the persisted settings.
    await hydrated(aiSettings);
    const found = await Promise.all(PROVIDER_ORDER.map(async (p) => [p, !!(await getKey(p))] as const));
    const connected: Partial<Record<ProviderId, boolean>> = {};
    for (const [p, has] of found) if (p === 'custom' ? !!aiSettings.getState().baseUrls.custom : has) connected[p] = true;
    aiSettings.setState({ connected, hasKey: anyConnected(connected) });
  })();
  return checking;
}

export const useAiSettings = <T>(selector: (s: AiSettings) => T) => {
  if (aiSettings.getState().hasKey === null) refreshKeys();
  return useStore(aiSettings, selector);
};

// Kept for the code written when Tide only had Anthropic.
export const getApiKey = () => getKey('anthropic');
export const setApiKey = (value: string) => setKey('anthropic', value);
