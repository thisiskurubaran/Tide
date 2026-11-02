// The tip jar: optional one-off tips that support Tide's development. They
// unlock nothing; every feature in Tide stays free.
import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { TipPurchases } from './purchases';

export const TIP_PREFIX = 'com.thisiskurubaran.tide.tip';

export interface Tip {
  id: 'small' | 'medium' | 'large';
  productId: string;
  title: string;
  emoji: string;
  // Shown until the store returns the localized price.
  fallbackPrice: string;
}

export const TIPS: Tip[] = [
  { id: 'small', productId: `${TIP_PREFIX}.small`, title: 'Small tip', emoji: '☕', fallbackPrice: '$1.99' },
  { id: 'medium', productId: `${TIP_PREFIX}.medium`, title: 'Medium tip', emoji: '🍕', fallbackPrice: '$4.99' },
  { id: 'large', productId: `${TIP_PREFIX}.large`, title: 'Large tip', emoji: '🎉', fallbackPrice: '$9.99' },
];

const tipFor = (productId: string) => TIPS.find((t) => t.productId === productId);

export interface TipsState {
  // How many tips this device has given, for the thank-you line.
  given: number;
  prices: Partial<Record<Tip['id'], string>>;
  busy: Tip['id'] | null;
  // The tip just given, until the thank-you is dismissed.
  thanked: Tip['id'] | null;
  error: string | null;
  refresh(): Promise<void>;
  give(id: Tip['id']): Promise<void>;
  dismiss(): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createTipsStore(storage: StateStorage, purchases: TipPurchases) {
  const store = createStore<TipsState>()(
    persist(
      (set, get) => ({
        given: 0,
        prices: {},
        busy: null,
        thanked: null,
        error: null,
        async refresh() {
          const products = await purchases.products(TIPS.map((t) => t.productId));
          const prices: TipsState['prices'] = {};
          for (const p of products) {
            const tip = tipFor(p.productId);
            if (tip) prices[tip.id] = p.price;
          }
          set({ prices });
        },
        async give(id) {
          if (get().busy) return;
          set({ busy: id, error: null, thanked: null });
          try {
            const result = await purchases.buy(TIPS.find((t) => t.id === id)!.productId);
            if (result === 'purchased') set((s) => ({ given: s.given + 1, thanked: id }));
            else if (result === 'pending') set({ error: 'Your tip is waiting for approval. Thank you!' });
          } catch (e) {
            set({ error: message(e) });
          } finally {
            set({ busy: null });
          }
        },
        dismiss: () => set({ thanked: null, error: null }),
      }),
      {
        name: 'tips',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ given, prices }) => ({ given, prices }),
      },
    ),
  );
  // Approved later (Ask to Buy) or replayed at launch.
  purchases.onTip((productId) => {
    const tip = tipFor(productId);
    if (tip) store.setState((s) => ({ given: s.given + 1, thanked: tip.id }));
  });
  return store;
}
