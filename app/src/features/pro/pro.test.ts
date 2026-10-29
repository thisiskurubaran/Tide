import { createFakePurchases } from '../../extensions/purchases';
import { createExtensionsStore, isActive } from '../../extensions/store';
import { createMemoryFs } from '../files/memoryFs';
import { createFsStorage } from '../../state/storage';
import { planFor, PLANS } from './plans';
import { createProStore, isPro, OFFLINE_GRACE_MS, proStatus } from './store';

const DAY = 24 * 60 * 60 * 1000;
const prices = Object.fromEntries(PLANS.map((p) => [p.productId, p.fallbackPrice.replace('$', 'US$')]));
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: Parameters<typeof createFakePurchases>[1] = {}) {
  const storage = createFsStorage(createMemoryFs());
  const purchases = createFakePurchases(prices, { trials: { [planFor('yearly').productId]: '7 days' }, ...opts });
  return { storage, purchases, store: createProStore(storage, purchases) };
}

describe('Tide Pro', () => {
  it('loads prices and the trial for accounts that can have it', async () => {
    const { store } = setup();
    await store.getState().refresh();
    expect(store.getState().prices).toEqual({ yearly: 'US$24.99', monthly: 'US$2.99', lifetime: 'US$59.99' });
    expect(store.getState().trial).toBe('7 days');
    expect(isPro(store.getState())).toBe(false);
  });

  it('unlocks with a subscription, and the trial is gone after', async () => {
    const { store } = setup();
    await store.getState().refresh();
    expect(await store.getState().buy('yearly')).toBe(true);
    expect(store.getState().subscription?.productId).toBe(planFor('yearly').productId);
    expect(store.getState().trial).toBeNull();
    expect(proStatus(store.getState())).toMatch(/^Yearly, renews /);
    await store.getState().refresh();
    expect(store.getState().trial).toBeNull();
  });

  it('unlocks for good with lifetime, and remembers it offline', async () => {
    const { store, storage } = setup();
    await store.getState().buy('lifetime');
    expect(isPro(store.getState())).toBe(true);
    expect(proStatus(store.getState())).toBe('Lifetime');
    await flush();
    const offline = createProStore(storage, { ...createFakePurchases(), owned: async () => Promise.reject(new Error('offline')) });
    await offline.persist.rehydrate();
    expect(isPro(offline.getState())).toBe(true);
  });

  it("keeps Pro a few days past the period when the store can't confirm, then stops", () => {
    const now = 100 * DAY;
    const sub = { productId: planFor('monthly').productId, expiresAt: now - DAY, willRenew: true };
    expect(isPro({ lifetime: false, subscription: sub }, now)).toBe(true);
    expect(isPro({ lifetime: false, subscription: sub }, now + OFFLINE_GRACE_MS)).toBe(false);
    expect(proStatus({ lifetime: false, subscription: { ...sub, expiresAt: now + DAY, willRenew: false } }, now)).toMatch(/^Monthly, ends /);
  });

  it('drops a lapsed subscription when the store says so', async () => {
    let now = 0;
    const { store } = setup({ subscriptionMs: 30 * DAY, now: () => now });
    await store.getState().buy('monthly');
    now = 31 * DAY;
    await store.getState().refresh();
    expect(store.getState().subscription).toBeNull();
    expect(isPro(store.getState(), now)).toBe(false);
  });

  it('restores, and says so when there is nothing to restore', async () => {
    const { store, purchases } = setup();
    expect(await store.getState().restore()).toBe(false);
    expect(store.getState().error).toMatch(/No Tide Pro purchase/);
    purchases.owned_.add(planFor('lifetime').productId);
    expect(await store.getState().restore()).toBe(true);
  });

  it('turns on every extension while Pro', async () => {
    const ext = createExtensionsStore(createFsStorage(createMemoryFs()), createFakePurchases());
    expect(isActive(ext.getState(), 'debugger')).toBe(false);
    ext.setState({ included: true });
    expect(isActive(ext.getState(), 'debugger')).toBe(true);
    ext.getState().setEnabled('debugger', false);
    expect(isActive(ext.getState(), 'debugger')).toBe(false);
  });
});
