// In-app purchases behind a small interface, so the extensions store can be
// tested with a fake. The real one is expo-iap (StoreKit 2 and Play Billing).
export type BuyResult = 'purchased' | 'cancelled' | 'pending';

// One-time purchases (extensions, Pro lifetime) or auto-renewing subscriptions.
export type ProductKind = 'in-app' | 'subs';

export interface StoreProduct {
  productId: string;
  // Localized, e.g. "₹249.00".
  price: string;
  // Subscriptions with a free trial introductory offer: its length, e.g. "7 days".
  trial?: string;
  // App Store subscription group, for checking trial eligibility.
  groupId?: string;
}

export interface ActiveSubscription {
  productId: string;
  // When the current period ends (ms since 1970); null if the store didn't say.
  expiresAt: number | null;
  // False once the user turned off auto-renew; null if unknown.
  willRenew: boolean | null;
}

export interface PurchaseProvider {
  products(productIds: string[], kind?: ProductKind): Promise<StoreProduct[]>;
  // Opens the store's purchase sheet and settles when the user finishes with it.
  buy(productId: string, kind?: ProductKind): Promise<BuyResult>;
  // The given subscriptions this account is currently subscribed to.
  subscriptions(productIds: string[]): Promise<ActiveSubscription[]>;
  // Whether this account can still get the introductory offer (free trial)
  // in a subscription group; Apple gives it once per group.
  trialEligible(groupId: string): Promise<boolean>;
  // The system's subscription management (cancel, change plan).
  manageSubscriptions(): Promise<void>;
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
    async products(productIds, kind = 'in-app') {
      const mod = await connect();
      const products = (await mod.fetchProducts({ skus: productIds, type: kind })) ?? [];
      return products.map((p) => {
        const product: StoreProduct = { productId: p.id, price: p.displayPrice };
        if (p.platform === 'ios' && p.type === 'subs') {
          product.groupId = p.subscriptionGroupIdIOS ?? undefined;
          if (p.introductoryPricePaymentModeIOS === 'free-trial') product.trial = trialLength(p.introductoryPriceNumberOfPeriodsIOS, p.introductoryPriceSubscriptionPeriodIOS);
        }
        return product;
      });
    },
    async buy(productId, kind = 'in-app') {
      const mod = await connect();
      const done = new Promise<BuyResult>((resolve, reject) => {
        waiting.set(productId, (result) => (result instanceof Error ? reject(result) : resolve(result)));
      });
      try {
        await mod.requestPurchase({ request: { apple: { sku: productId }, google: { skus: [productId] } }, type: kind });
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
    async subscriptions(productIds) {
      const mod = await connect();
      const subs = (await mod.getActiveSubscriptions(productIds)) ?? [];
      return subs
        .filter((s) => s.isActive)
        .map((s) => ({ productId: s.productId, expiresAt: s.expirationDateIOS ?? null, willRenew: s.renewalInfoIOS?.willAutoRenew ?? s.autoRenewingAndroid ?? null }));
    },
    async trialEligible(groupId) {
      const mod = await connect();
      return mod.isEligibleForIntroOfferIOS(groupId).catch(() => false);
    },
    async manageSubscriptions() {
      const mod = await connect();
      await mod.deepLinkToSubscriptions();
    },
    onPurchase(listener) {
      listeners.add(listener);
    },
  };
}

// "1" + "week" -> "7 days", "1" + "month" -> "1 month".
export function trialLength(count: string | null | undefined, unit: string | null | undefined): string | undefined {
  const n = Number(count ?? 1) || 1;
  if (!unit || unit === 'empty') return undefined;
  if (unit === 'week') return `${n * 7} days`;
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

// For development builds and tests: everything is free and owned only after
// buy(). Subscriptions bought here last `subscriptionMs`.
export function createFakePurchases(
  prices: Record<string, string> = {},
  { subscriptionMs = 30 * 24 * 60 * 60 * 1000, trials = {} as Record<string, string>, now = Date.now } = {},
): PurchaseProvider & { owned_: Set<string>; subs_: Map<string, ActiveSubscription> } {
  const owned_ = new Set<string>();
  const subs_ = new Map<string, ActiveSubscription>();
  const listeners = new Set<(productId: string) => void>();
  return {
    owned_,
    subs_,
    async products(ids) {
      return ids.filter((id) => prices[id]).map((id) => ({ productId: id, price: prices[id], ...(trials[id] ? { trial: trials[id], groupId: 'fake-group' } : {}) }));
    },
    async buy(productId, kind = 'in-app') {
      if (kind === 'subs') subs_.set(productId, { productId, expiresAt: now() + subscriptionMs, willRenew: true });
      else owned_.add(productId);
      for (const listener of listeners) listener(productId);
      return 'purchased';
    },
    async subscriptions(ids) {
      return [...subs_.values()].filter((s) => ids.includes(s.productId) && (s.expiresAt ?? Infinity) > now());
    },
    trialEligible: async () => subs_.size === 0,
    manageSubscriptions: async () => undefined,
    owned: async () => [...owned_],
    restore: async () => [...owned_],
    onPurchase: (listener) => void listeners.add(listener),
  };
}
