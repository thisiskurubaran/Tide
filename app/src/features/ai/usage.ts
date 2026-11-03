// What the AI features used this calendar month: tokens per provider and
// model, and an estimated cost where Tide knows the price. Kept on the
// device only; the provider's own console has the real bill.
import { createStore, StoreApi, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { storage } from '../../state';
import type { ProviderId, Usage } from './providers/types';

// US dollars per million tokens, input and output.
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export function priceOf(provider: ProviderId, model: string): { input: number; output: number } | null {
  if (provider !== 'anthropic') return null;
  return PRICES[model] ?? Object.entries(PRICES).find(([id]) => model.startsWith(`${id}-`))?.[1] ?? null;
}

// The cost in dollars, or null when the price isn't known.
export function costOf(provider: ProviderId, model: string, usage: Usage): number | null {
  const price = priceOf(provider, model);
  return price ? (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000 : null;
}

export const monthOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export interface ModelUsage {
  provider: ProviderId;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  // Null when any of it was at an unknown price.
  costUsd: number | null;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  // The known part of the cost.
  costUsd: number;
  // Whether some of the month's use is at a price Tide doesn't know.
  unknownPrice: boolean;
}

export interface UsageState {
  month: string;
  byModel: Record<string, ModelUsage>;
  record(provider: ProviderId, model: string, usage: Usage, now?: Date): void;
  // This month's entries, after starting a new month if one has begun.
  current(now?: Date): ModelUsage[];
  totals(now?: Date): UsageTotals;
}

export function createUsageStore(store: StateStorage<Promise<void>> | StateStorage): StoreApi<UsageState> {
  return createStore<UsageState>()(
    persist(
      (set, get) => {
        const rolled = (now: Date) => {
          const month = monthOf(now);
          if (get().month !== month) set({ month, byModel: {} });
          return get();
        };
        return {
          month: monthOf(new Date()),
          byModel: {},
          record(provider, model, usage, now = new Date()) {
            const s = rolled(now);
            const id = `${provider}:${model}`;
            const prev = s.byModel[id] ?? { provider, model, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
            const cost = costOf(provider, model, usage);
            set({
              byModel: {
                ...s.byModel,
                [id]: {
                  ...prev,
                  requests: prev.requests + 1,
                  inputTokens: prev.inputTokens + usage.inputTokens,
                  outputTokens: prev.outputTokens + usage.outputTokens,
                  costUsd: prev.costUsd === null || cost === null ? null : prev.costUsd + cost,
                },
              },
            });
          },
          current(now = new Date()) {
            return Object.values(rolled(now).byModel);
          },
          totals(now = new Date()) {
            return totalsOf(get().month === monthOf(now) ? Object.values(get().byModel) : []);
          },
        };
      },
      { name: 'ai-usage', version: 1, storage: createJSONStorage(() => store), partialize: ({ month, byModel }) => ({ month, byModel }) },
    ),
  );
}

export function totalsOf(entries: ModelUsage[]): UsageTotals {
  return entries.reduce<UsageTotals>(
    (t, e) => ({
      inputTokens: t.inputTokens + e.inputTokens,
      outputTokens: t.outputTokens + e.outputTokens,
      costUsd: t.costUsd + (e.costUsd ?? 0),
      unknownPrice: t.unknownPrice || e.costUsd === null,
    }),
    { inputTokens: 0, outputTokens: 0, costUsd: 0, unknownPrice: false },
  );
}

export const usageStore = createUsageStore(storage);

export const useUsage = <T>(selector: (s: UsageState) => T) => useStore(usageStore, selector);

// Whether this month's estimated spend has reached the limit (null: no limit).
export function overLimit(limitUsd: number | null, now = new Date()): boolean {
  return limitUsd !== null && usageStore.getState().totals(now).costUsd >= limitUsd;
}

export const formatUsd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);

export const formatTokens = (n: number) => (n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`);
