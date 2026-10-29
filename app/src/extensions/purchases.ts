// In-app purchases behind a small interface, so the extensions store can be
// tested with a fake. The real one is expo-iap (StoreKit 2 and Play Billing).
export type BuyResult = 'purchased' | 'cancelled' | 'pending';

export interface StoreProduct {
  productId: string;
  // Localized, e.g. "₹249.00".
  price: string;
}

export interface PurchaseProvider {
  products(productIds: string[]): Promise<StoreProduct[]>;
  // Opens the store's purchase sheet and settles when the user finishes with it.
  buy(productId: string): Promise<BuyResult>;
  // Product ids the store says this account owns. Restore asks the store to
  // sync first, which on iOS may show a sign-in prompt.
  owned(): Promise<string[]>;
  restore(): Promise<string[]>;
  // Purchases that complete outside buy(): Ask to Buy approvals, pending
  // payments and transactions the store replays at launch.
  onPurchase(listener: (productId: string) => void): void;
}

type Iap = typeof import('expo-iap');
type Purchase = import('expo-iap').Purchase;

export function createStorePurchases(load: () => Iap = () => require('expo-iap')): PurchaseProvider {
  let iap: Iap | null = null;
  let connecting: Promise<Iap> | null = null;
  const listeners = new Set<(productId: string) => void>();
  // Settles the buy() waiting on a product, if there is one.
  const waiting = new Map<string, (result: BuyResult | Error) => void>();

  // Non-consumables have to be finished, or Google refunds them after three
  // days and StoreKit replays them on every launch.
  async function settle(purchase: Purchase) {
    if (purchase.purchaseState === 'pending') {
      waiting.get(purchase.productId)?.('pending');
      waiting.delete(purchase.productId);
      return;
    }
    await iap!.finishTransaction({ purchase, isConsumable: false }).catch(() => undefined);
    for (const listener of listeners) listener(purchase.productId);
    waiting.get(purchase.productId)?.('purchased');
    waiting.delete(purchase.productId);
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

  const ownedIds = (purchases: Purchase[]) => [...new Set(purchases.filter((p) => p.purchaseState === 'purchased').map((p) => p.productId))];

  return {
    async products(productIds) {
      const mod = await connect();
      const products = (await mod.fetchProducts({ skus: productIds, type: 'in-app' })) ?? [];
      return products.map((p) => ({ productId: p.id, price: p.displayPrice }));
    },
    async buy(productId) {
      const mod = await connect();
      const done = new Promise<BuyResult>((resolve, reject) => {
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
    async owned() {
      const mod = await connect();
      return ownedIds(await mod.getAvailablePurchases());
    },
    async restore() {
      const mod = await connect();
      await mod.restorePurchases();
      return ownedIds(await mod.getAvailablePurchases());
    },
    onPurchase(listener) {
      listeners.add(listener);
    },
  };
}

// For development builds and tests: everything is free and owned only after buy().
export function createFakePurchases(prices: Record<string, string> = {}): PurchaseProvider & { owned_: Set<string> } {
  const owned_ = new Set<string>();
  const listeners = new Set<(productId: string) => void>();
  return {
    owned_,
    async products(ids) {
      return ids.filter((id) => prices[id]).map((id) => ({ productId: id, price: prices[id] }));
    },
    async buy(productId) {
      owned_.add(productId);
      for (const listener of listeners) listener(productId);
      return 'purchased';
    },
    owned: async () => [...owned_],
    restore: async () => [...owned_],
    onPurchase: (listener) => void listeners.add(listener),
  };
}
