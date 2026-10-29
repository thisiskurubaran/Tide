import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { ExtensionId, manifestFor, manifestForProduct, manifests } from './manifests';
import type { PurchaseProvider } from './purchases';

// Settings that belong to one extension. Kept here rather than in the app
// settings so they go away with the extension's store entry.
export interface ExtensionPrefs {
  // Themes & Icons: a theme id from themes/catalog, or null for the default FuseOps theme.
  theme: string | null;
  fileIcons: boolean;
  // Format & Lint
  formatOnSave: boolean;
  lintAsYouType: boolean;
}

export const DEFAULT_PREFS: ExtensionPrefs = { theme: null, fileIcons: true, formatOnSave: false, lintAsYouType: true };

export interface ExtensionsState {
  // Extensions this device knows the user bought. Cached so they keep working
  // offline; refreshed from the store whenever it can be reached.
  owned: ExtensionId[];
  // Owned extensions the user switched off.
  disabled: ExtensionId[];
  // Tide Pro includes every extension; set from the Pro store, not persisted.
  included: boolean;
  prices: Partial<Record<ExtensionId, string>>;
  prefs: ExtensionPrefs;
  busy: ExtensionId | 'restore' | null;
  error: string | null;
  // Asks the store for prices and what this account owns.
  refresh(): Promise<void>;
  buy(id: ExtensionId): Promise<void>;
  restore(): Promise<void>;
  setEnabled(id: ExtensionId, enabled: boolean): void;
  setPref<K extends keyof ExtensionPrefs>(key: K, value: ExtensionPrefs[K]): void;
  clearError(): void;
}

export const isActive = (s: Pick<ExtensionsState, 'owned' | 'disabled'> & { included?: boolean }, id: ExtensionId) =>
  (s.owned.includes(id) || !!s.included) && !s.disabled.includes(id);

// Bought, or included with Pro: what the Extensions screen shows as available.
export const isAvailable = (s: Pick<ExtensionsState, 'owned' | 'included'>, id: ExtensionId) => s.owned.includes(id) || s.included;

const idsFor = (productIds: string[]) =>
  productIds.map((p) => manifestForProduct(p)?.id).filter((id): id is ExtensionId => id !== undefined);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createExtensionsStore(storage: StateStorage, purchases: PurchaseProvider) {
  const store = createStore<ExtensionsState>()(
    persist(
      (set, get) => {
        const grant = (ids: ExtensionId[]) =>
          set((s) => ({ owned: [...new Set([...s.owned, ...ids])].sort() }));

        return {
          owned: [],
          disabled: [],
          included: false,
          prices: {},
          prefs: DEFAULT_PREFS,
          busy: null,
          error: null,
          async refresh() {
            const productIds = manifests.map((m) => m.productId);
            const [products, owned] = await Promise.allSettled([purchases.products(productIds), purchases.owned()]);
            if (products.status === 'fulfilled') {
              const prices: ExtensionsState['prices'] = {};
              for (const p of products.value) {
                const id = manifestForProduct(p.productId)?.id;
                if (id) prices[id] = p.price;
              }
              set({ prices });
            }
            // Purchases are only ever added here. A refund is applied by the
            // store on the next launch with a successful restore, not by a
            // flaky query that came back empty.
            if (owned.status === 'fulfilled') grant(idsFor(owned.value));
          },
          async buy(id) {
            if (get().busy) return;
            set({ busy: id, error: null });
            try {
              const result = await purchases.buy(manifestFor(id).productId);
              if (result === 'purchased') grant([id]);
              else if (result === 'pending') set({ error: 'The purchase is waiting for approval. It unlocks as soon as it goes through.' });
            } catch (e) {
              set({ error: message(e) });
            } finally {
              set({ busy: null });
            }
          },
          async restore() {
            if (get().busy) return;
            set({ busy: 'restore', error: null });
            try {
              // A restore is the store's answer for this account, so it replaces the cache.
              set({ owned: idsFor(await purchases.restore()).sort() });
            } catch (e) {
              set({ error: message(e) });
            } finally {
              set({ busy: null });
            }
          },
          setEnabled: (id, enabled) =>
            set((s) => ({ disabled: enabled ? s.disabled.filter((d) => d !== id) : [...new Set([...s.disabled, id])] })),
          setPref: (key, value) => set((s) => ({ prefs: { ...s.prefs, [key]: value } })),
          clearError: () => set({ error: null }),
        };
      },
      {
        name: 'extensions',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ owned, disabled, prices, prefs }) => ({ owned, disabled, prices, prefs }),
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<ExtensionsState>;
          return { ...current, ...p, prefs: { ...DEFAULT_PREFS, ...p.prefs } };
        },
      },
    ),
  );
  purchases.onPurchase((productId) => {
    const id = manifestForProduct(productId)?.id;
    if (id) store.setState((s) => ({ owned: [...new Set([...s.owned, id])].sort() }));
  });
  return store;
}
