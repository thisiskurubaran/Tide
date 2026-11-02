/**
 * @jest-environment node
 */
/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { createMemoryFs } from '../files/memoryFs';
import { createFsStorage } from '../../state/storage';
import { createFakeTips, createStoreTips, TipPurchases } from './purchases';
import { createTipsStore, TIPS } from './tips';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const id = (tip: string) => `com.thisiskurubaran.tide.tip.${tip}`;

describe('tip jar', () => {
  it('shows store prices and thanks the user for a tip', async () => {
    const storage = createFsStorage(createMemoryFs());
    const purchases = createFakeTips({ [id('small')]: '₹169' });
    const store = createTipsStore(storage, purchases);
    await store.getState().refresh();
    expect(store.getState().prices).toEqual({ small: '₹169' });
    await store.getState().give('medium');
    expect(purchases.bought).toEqual([id('medium')]);
    expect(store.getState()).toMatchObject({ given: 1, thanked: 'medium', busy: null, error: null });
    store.getState().dismiss();
    expect(store.getState().thanked).toBeNull();
    await flush();
    const restarted = createTipsStore(storage, createFakeTips());
    await flush();
    expect(restarted.getState().given).toBe(1);
  });

  it('says nothing for a cancelled tip and explains a pending one', async () => {
    const cancelled = createTipsStore(createFsStorage(createMemoryFs()), createFakeTips({}, 'cancelled'));
    await cancelled.getState().give('small');
    expect(cancelled.getState()).toMatchObject({ given: 0, thanked: null, error: null });
    const pending = createTipsStore(createFsStorage(createMemoryFs()), createFakeTips({}, 'pending'));
    await pending.getState().give('small');
    expect(pending.getState().given).toBe(0);
    expect(pending.getState().error).toMatch(/waiting for approval/);
  });

  it('reports a failed purchase', async () => {
    const failing: TipPurchases = { ...createFakeTips(), buy: async () => Promise.reject(new Error('Payment declined')) };
    const store = createTipsStore(createFsStorage(createMemoryFs()), failing);
    await store.getState().give('large');
    expect(store.getState()).toMatchObject({ error: 'Payment declined', busy: null, given: 0 });
  });

  it('counts tips that arrive later, like Ask to Buy approvals', async () => {
    let deliver: (productId: string) => void = () => undefined;
    const purchases: TipPurchases = { ...createFakeTips(), onTip: (fn) => void (deliver = fn) };
    const store = createTipsStore(createFsStorage(createMemoryFs()), purchases);
    deliver(id('large'));
    deliver('something.else');
    expect(store.getState()).toMatchObject({ given: 1, thanked: 'large' });
  });
});

// A stand-in for expo-iap: purchases complete through the listeners, as they do on a device.
function fakeIap() {
  let updated: (p: unknown) => void = () => undefined;
  let failed: (e: unknown) => void = () => undefined;
  const finished: { productId: string; consumable: boolean }[] = [];
  const mod = {
    initConnection: jest.fn(async () => true),
    purchaseUpdatedListener: (fn: (p: unknown) => void) => {
      updated = fn;
      return { remove() {} };
    },
    purchaseErrorListener: (fn: (e: unknown) => void) => {
      failed = fn;
      return { remove() {} };
    },
    fetchProducts: jest.fn(async ({ skus }: { skus: string[] }) => skus.map((sku) => ({ id: sku, displayPrice: '$1.99' }))),
    requestPurchase: jest.fn(async () => null),
    finishTransaction: async ({ purchase, isConsumable }: { purchase: { productId: string }; isConsumable: boolean }) =>
      void finished.push({ productId: purchase.productId, consumable: isConsumable }),
    isUserCancelledError: (e: { code?: string }) => e.code === 'user-cancelled',
    getUserFriendlyErrorMessage: (e: { message?: string }) => e.message ?? 'failed',
  };
  return { mod, finished, complete: (p: unknown) => updated(p), fail: (e: unknown) => failed(e) };
}

describe('store tips (expo-iap)', () => {
  it('connects once, buys a tip and finishes it as a consumable', async () => {
    const iap = fakeIap();
    const tips = createStoreTips(() => iap.mod as never);
    expect(await tips.products([id('small')])).toEqual([{ productId: id('small'), price: '$1.99' }]);
    const done = tips.buy(id('small'));
    await flush();
    iap.complete({ productId: id('small'), purchaseState: 'purchased' });
    await expect(done).resolves.toBe('purchased');
    expect(iap.finished).toEqual([{ productId: id('small'), consumable: true }]);
    expect(iap.mod.initConnection).toHaveBeenCalledTimes(1);
  });

  it('settles cancelled, failed and pending purchases', async () => {
    const iap = fakeIap();
    const tips = createStoreTips(() => iap.mod as never);
    const cancelled = tips.buy(id('small'));
    await flush();
    iap.fail({ code: 'user-cancelled' });
    await expect(cancelled).resolves.toBe('cancelled');
    const failed = tips.buy(id('small'));
    await flush();
    iap.fail({ code: 'network', message: 'No connection' });
    await expect(failed).rejects.toThrow('No connection');
    const pending = tips.buy(id('large'));
    await flush();
    iap.complete({ productId: id('large'), purchaseState: 'pending' });
    await expect(pending).resolves.toBe('pending');
    expect(iap.finished).toEqual([]);
  });

  it('finishes tips replayed at launch and reports them', async () => {
    const iap = fakeIap();
    const tips = createStoreTips(() => iap.mod as never);
    const seen: string[] = [];
    tips.onTip((p) => seen.push(p));
    await tips.start();
    iap.complete({ productId: id('medium'), purchaseState: 'purchased' });
    await flush();
    expect(seen).toEqual([id('medium')]);
    expect(iap.finished).toEqual([{ productId: id('medium'), consumable: true }]);
  });
});

// The StoreKit configuration for testing in Xcode lists exactly the tips.
it('matches the StoreKit configuration', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../storekit/Tide.storekit'), 'utf8'));
  const products = config.products.map((p: { productID: string; displayPrice: string; type: string }) => [p.productID, `$${p.displayPrice}`, p.type]);
  expect(products).toEqual(TIPS.map((t) => [t.productId, t.fallbackPrice, 'Consumable']));
  expect(config.subscriptionGroups).toEqual([]);
});
