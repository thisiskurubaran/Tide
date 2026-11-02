// Tips through the App Store and Google Play (expo-iap: StoreKit 2 and Play
// Billing), behind a small interface so the tip jar can be tested with a fake.
// Tips are consumables: they unlock nothing and can be given again.
export type TipResult = 'purchased' | 'cancelled' | 'pending';

export interface StoreProduct {
  productId: string;
  // Localized, e.g. "₹249.00".
  price: string;
}

export interface TipPurchases {
  products(productIds: string[]): Promise<StoreProduct[]>;
  // Opens the store's purchase sheet and settles when the user finishes with it.
  buy(productId: string): Promise<TipResult>;
  // Tips that complete outside buy(): Ask to Buy approvals, pending payments
  // and unfinished transactions the store replays at launch.
  onTip(listener: (productId: string) => void): void;
  // Connects early so replayed transactions are finished.
  start(): Promise<void>;
}

type Iap = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;

export function createStoreTips(load: () => Iap = () => require('expo-iap')): TipPurchases {
  let iap: Iap | null = null;
  let connecting: Promise<Iap> | null = null;
  const listeners = new Set<(productId: string) => void>();
  // Settles the buy() waiting on a product, if there is one.
  const waiting = new Map<string, (result: TipResult | Error) => void>();

  // A consumable has to be finished, or the store replays it on every launch
  // (and Google refunds it after three days).
  async function settle(purchase: Purchase) {
    if (purchase.purchaseState === 'pending') {
      waiting.get(purchase.productId)?.('pending');
      waiting.delete(purchase.productId);
      return;
    }
    await iap!.finishTransaction({ purchase, isConsumable: true }).catch(() => undefined);
    const resolve = waiting.get(purchase.productId);
    waiting.delete(purchase.productId);
    if (resolve) resolve('purchased');
    else for (const listener of listeners) listener(purchase.productId);
  }

  function connect(): Promise<Iap> {
    connecting ??= (async () => {
      const mod = load();
      await mod.initConnection();
      iap = mod;
      mod.purchaseUpdatedListener((purchase) => {
        settle(purchase).catch(() => undefined);
      });
      mod.purchaseErrorListener((error) => {
        // The error doesn't always say which product it is for; only one sheet is open at a time.
        const [productId, resolve] = [...waiting][0] ?? [];
        if (!resolve) return;
        waiting.delete(productId!);
        resolve(mod.isUserCancelledError(error) ? 'cancelled' : new Error(mod.getUserFriendlyErrorMessage(error)));
      });
      return mod;
    })().catch((e) => {
      connecting = null;
      throw e;
    });
    return connecting;
  }

  return {
    async products(productIds) {
      const mod = await connect();
      const products = (await mod.fetchProducts({ skus: productIds, type: 'in-app' })) ?? [];
      return products.map((p) => ({ productId: p.id, price: p.displayPrice }));
    },
    async buy(productId) {
      const mod = await connect();
      const done = new Promise<TipResult>((resolve, reject) => {
        waiting.set(productId, (result) => (result instanceof Error ? reject(result) : resolve(result)));
      });
      try {
        await mod.requestPurchase({ request: { apple: { sku: productId }, google: { skus: [productId] } }, type: 'in-app' });
      } catch (e) {
        waiting.delete(productId);
        if (mod.isUserCancelledError(e as never)) return 'cancelled';
        throw e;
      }
      return done;
    },
    onTip(listener) {
      listeners.add(listener);
    },
    async start() {
      await connect();
    },
  };
}

// For development builds and tests: every tip goes through at once.
export function createFakeTips(prices: Record<string, string> = {}, result: TipResult = 'purchased'): TipPurchases & { bought: string[] } {
  const bought: string[] = [];
  return {
    bought,
    async products(ids) {
      return ids.filter((id) => prices[id]).map((id) => ({ productId: id, price: prices[id] }));
    },
    async buy(productId) {
      if (result === 'purchased') bought.push(productId);
      return result;
    },
    onTip: () => undefined,
    start: async () => undefined,
  };
}
