import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { ActiveSubscription, PurchaseProvider } from '../../extensions/purchases';
import { planFor, planForProduct, PlanId, PLANS, SUBSCRIPTION_IDS } from './plans';

// After a subscription's period ends, Pro stays on this long while the store
// can't be reached to confirm the renewal (offline, App Store hiccups).
export const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export interface ProState {
  // Cached so Pro works offline; refreshed from the store when it can be reached.
  lifetime: boolean;
  subscription: ActiveSubscription | null;
  prices: Partial<Record<PlanId, string>>;
  // The yearly plan's free trial, when this account can still get it.
  trial: string | null;
  busy: PlanId | 'restore' | null;
  error: string | null;
  refresh(): Promise<void>;
  buy(plan: PlanId): Promise<boolean>;
  restore(): Promise<boolean>;
  manage(): Promise<void>;
  clearError(): void;
}

export const isPro = (s: Pick<ProState, 'lifetime' | 'subscription'>, now = Date.now()) =>
  s.lifetime || (s.subscription !== null && (s.subscription.expiresAt === null || s.subscription.expiresAt + OFFLINE_GRACE_MS > now));

// What Settings says about the plan.
export function proStatus(s: Pick<ProState, 'lifetime' | 'subscription'>, now = Date.now()): string | null {
  if (s.lifetime) return 'Lifetime';
  const sub = s.subscription;
  if (!sub || !isPro(s, now)) return null;
  const plan = planForProduct(sub.productId)?.title ?? 'Pro';
  if (!sub.expiresAt) return plan;
  const date = new Date(sub.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return sub.willRenew === false ? `${plan}, ends ${date}` : `${plan}, renews ${date}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
// The subscription that runs longest, if several show up (e.g. mid-upgrade).
const latest = (subs: ActiveSubscription[]) => subs.reduce<ActiveSubscription | null>((a, b) => (!a || (b.expiresAt ?? Infinity) > (a.expiresAt ?? Infinity) ? b : a), null);

export function createProStore(storage: StateStorage, purchases: PurchaseProvider) {
  const lifetimeId = planFor('lifetime').productId;

  const store = createStore<ProState>()(
    persist(
      (set, get) => {
        async function loadSubscription() {
          set({ subscription: latest(await purchases.subscriptions(SUBSCRIPTION_IDS)) });
        }

        return {
          lifetime: false,
          subscription: null,
          prices: {},
          trial: null,
          busy: null,
          error: null,
          async refresh() {
            const subs = PLANS.filter((p) => p.kind === 'subs').map((p) => p.productId);
            const [subProducts, lifetimeProducts, owned, active] = await Promise.allSettled([
              purchases.products(subs, 'subs'),
              purchases.products([lifetimeId], 'in-app'),
              purchases.owned(),
              purchases.subscriptions(SUBSCRIPTION_IDS),
            ]);
            const products = [
              ...(subProducts.status === 'fulfilled' ? subProducts.value : []),
              ...(lifetimeProducts.status === 'fulfilled' ? lifetimeProducts.value : []),
            ];
            if (products.length) {
              const prices: ProState['prices'] = {};
              for (const p of products) {
                const plan = planForProduct(p.productId);
                if (plan) prices[plan.id] = p.price;
              }
              set({ prices });
            }
            // A lifetime purchase is only ever added here, like extensions; a
            // refund shows up through restore.
            if (owned.status === 'fulfilled' && owned.value.includes(lifetimeId)) set({ lifetime: true });
            // StoreKit answers this from the device's own entitlements, so an
            // answer, even an empty one, replaces the cache.
            if (active.status === 'fulfilled') set({ subscription: latest(active.value) });
            const yearly = products.find((p) => p.productId === planFor('yearly').productId);
            if (yearly?.trial && yearly.groupId) {
              const eligible = await purchases.trialEligible(yearly.groupId).catch(() => false);
              set({ trial: eligible ? yearly.trial : null });
            } else if (products.length) set({ trial: null });
          },
          async buy(planId) {
            if (get().busy) return false;
            const plan = planFor(planId);
            set({ busy: planId, error: null });
            try {
              const result = await purchases.buy(plan.productId, plan.kind);
              if (result === 'pending') set({ error: 'The purchase is waiting for approval. Pro unlocks as soon as it goes through.' });
              if (result !== 'purchased') return false;
              if (plan.kind === 'in-app') set({ lifetime: true });
              else await loadSubscription();
              set({ trial: null });
              return isPro(get());
            } catch (e) {
              set({ error: message(e) });
              return false;
            } finally {
              set({ busy: null });
            }
          },
          async restore() {
            if (get().busy) return false;
            set({ busy: 'restore', error: null });
            try {
              const owned = await purchases.restore();
              set({ lifetime: owned.includes(lifetimeId) });
              await loadSubscription();
              if (!isPro(get())) set({ error: 'No Tide Pro purchase was found for this Apple ID.' });
              return isPro(get());
            } catch (e) {
              set({ error: message(e) });
              return false;
            } finally {
              set({ busy: null });
            }
          },
          manage: () => purchases.manageSubscriptions(),
          clearError: () => set({ error: null }),
        };
      },
      {
        name: 'pro',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ lifetime, subscription, prices, trial }) => ({ lifetime, subscription, prices, trial }),
      },
    ),
  );

  // Ask to Buy approvals, renewals and purchases replayed at launch.
  purchases.onPurchase((productId) => {
    if (productId === lifetimeId) store.setState({ lifetime: true });
    else if (SUBSCRIPTION_IDS.includes(productId)) purchases.subscriptions(SUBSCRIPTION_IDS).then((subs) => store.setState({ subscription: latest(subs) }), () => undefined);
  });
  return store;
}
