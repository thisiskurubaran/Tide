import { createMemoryFs } from '../features/files/memoryFs';
import { createFsStorage } from '../state/storage';
import { createDiagnosticsStore, fileDiagnostics, lineStarts, offsetAt, positionAt } from './diagnostics';
import { manifestFor, manifests } from './manifests';
import { createFakePurchases, createStorePurchases, PurchaseProvider } from './purchases';
import { createExtensionsStore, isActive } from './store';
import { fileIconFor } from './themes/fileIcons';
import { colorThemes } from './themes/catalog';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const product = (id: string) => manifestFor(id as never).productId;

describe('manifests', () => {
  it('gives every extension its own product', () => {
    expect(new Set(manifests.map((m) => m.productId)).size).toBe(manifests.length);
    expect(manifests.map((m) => m.id)).toEqual(['themes', 'format-lint', 'git-pro', 'intellisense', 'debugger']);
  });
});

describe('extensions store', () => {
  it('unlocks an extension when it is bought and remembers it', async () => {
    const storage = createFsStorage(createMemoryFs());
    const purchases = createFakePurchases();
    const store = createExtensionsStore(storage, purchases);
    await flush();
    expect(isActive(store.getState(), 'themes')).toBe(false);
    await store.getState().buy('themes');
    expect(store.getState().owned).toEqual(['themes']);
    expect(isActive(store.getState(), 'themes')).toBe(true);
    expect(isActive(store.getState(), 'debugger')).toBe(false);
    await flush();
    const restarted = createExtensionsStore(storage, createFakePurchases());
    await flush();
    expect(restarted.getState().owned).toEqual(['themes']);
  });

  it('switches an owned extension off and on', async () => {
    const store = createExtensionsStore(createFsStorage(createMemoryFs()), createFakePurchases());
    await store.getState().buy('git-pro');
    store.getState().setEnabled('git-pro', false);
    expect(isActive(store.getState(), 'git-pro')).toBe(false);
    store.getState().setEnabled('git-pro', true);
    expect(isActive(store.getState(), 'git-pro')).toBe(true);
  });

  it('shows store prices and keeps cached purchases when the store is unreachable', async () => {
    const offline: PurchaseProvider = {
      products: async () => [{ productId: product('debugger'), price: '₹799' }],
      owned: async () => {
        throw new Error('offline');
      },
      buy: async () => 'cancelled',
      restore: async () => [],
      onPurchase: () => undefined,
    };
    const storage = createFsStorage(createMemoryFs());
    await storage.setItem('extensions', JSON.stringify({ state: { owned: ['themes'] }, version: 1 }));
    const store = createExtensionsStore(storage, offline);
    await flush();
    await store.getState().refresh();
    expect(store.getState().prices.debugger).toBe('₹799');
    expect(store.getState().owned).toEqual(['themes']);
  });

  it('replaces the cache with what restore returns', async () => {
    const purchases = createFakePurchases();
    const store = createExtensionsStore(createFsStorage(createMemoryFs()), purchases);
    store.setState({ owned: ['themes', 'debugger'] });
    purchases.owned_.add(product('intellisense'));
    await store.getState().restore();
    expect(store.getState().owned).toEqual(['intellisense']);
  });

  it('reports a cancelled purchase without an error and a failed one with it', async () => {
    let result: 'cancelled' | Error = 'cancelled';
    const purchases: PurchaseProvider = {
      products: async () => [],
      owned: async () => [],
      buy: async () => {
        if (result instanceof Error) throw result;
        return result;
      },
      restore: async () => [],
      onPurchase: () => undefined,
    };
    const store = createExtensionsStore(createFsStorage(createMemoryFs()), purchases);
    await store.getState().buy('themes');
    expect(store.getState()).toMatchObject({ owned: [], error: null, busy: null });
    result = new Error('Payment declined');
    await store.getState().buy('themes');
    expect(store.getState()).toMatchObject({ owned: [], error: 'Payment declined', busy: null });
  });

  it('grants purchases that complete later, like Ask to Buy', async () => {
    const purchases = createFakePurchases();
    const store = createExtensionsStore(createFsStorage(createMemoryFs()), purchases);
    await purchases.buy(product('format-lint'));
    expect(store.getState().owned).toEqual(['format-lint']);
  });
});

// A stand-in for expo-iap: purchases complete through the listeners, as they do on a device.
function fakeIap() {
  let updated: (p: unknown) => void = () => undefined;
  let failed: (e: unknown) => void = () => undefined;
  const finished: string[] = [];
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
    fetchProducts: async ({ skus }: { skus: string[] }) => skus.map((id) => ({ id, displayPrice: '$1.00' })),
    requestPurchase: jest.fn(async () => null),
    finishTransaction: async ({ purchase }: { purchase: { productId: string } }) => void finished.push(purchase.productId),
    getAvailablePurchases: async () => [
      { productId: 'a', purchaseState: 'purchased' },
      { productId: 'b', purchaseState: 'pending' },
    ],
    restorePurchases: async () => undefined,
    isUserCancelledError: (e: { code?: string }) => e.code === 'user-cancelled',
    getUserFriendlyErrorMessage: (e: { message?: string }) => e.message ?? 'failed',
  };
  return { mod, finished, complete: (p: unknown) => updated(p), fail: (e: unknown) => failed(e) };
}

describe('store purchases (expo-iap)', () => {
  it('connects once, buys and finishes the transaction', async () => {
    const iap = fakeIap();
    const purchases = createStorePurchases(() => iap.mod as never);
    const done = purchases.buy('x');
    await flush();
    iap.complete({ productId: 'x', purchaseState: 'purchased' });
    await expect(done).resolves.toBe('purchased');
    expect(iap.finished).toEqual(['x']);
    await purchases.products(['x']);
    expect(iap.mod.initConnection).toHaveBeenCalledTimes(1);
  });

  it('settles a cancelled sheet as cancelled and other errors as failures', async () => {
    const iap = fakeIap();
    const purchases = createStorePurchases(() => iap.mod as never);
    const cancelled = purchases.buy('x');
    await flush();
    iap.fail({ code: 'user-cancelled' });
    await expect(cancelled).resolves.toBe('cancelled');
    const failed = purchases.buy('x');
    await flush();
    iap.fail({ code: 'network-error', message: 'No connection' });
    await expect(failed).rejects.toThrow('No connection');
  });

  it('counts only completed purchases as owned', async () => {
    const purchases = createStorePurchases(() => fakeIap().mod as never);
    await expect(purchases.owned()).resolves.toEqual(['a']);
  });

  it('reports pending purchases without finishing them', async () => {
    const iap = fakeIap();
    const purchases = createStorePurchases(() => iap.mod as never);
    const done = purchases.buy('x');
    await flush();
    iap.complete({ productId: 'x', purchaseState: 'pending' });
    await expect(done).resolves.toBe('pending');
    expect(iap.finished).toEqual([]);
  });
});

describe('diagnostics', () => {
  it('merges sources per file, sorted by position, and clears a source', () => {
    const store = createDiagnosticsStore();
    const d = (from: number, source: string) => ({ from, to: from + 1, line: 1, column: from + 1, severity: 'warning' as const, message: 'm', source });
    store.getState().set('p', 'a.js', 'eslint', [d(5, 'eslint')]);
    store.getState().set('p', 'a.js', 'ts', [d(2, 'ts')]);
    expect(fileDiagnostics(store.getState(), 'p', 'a.js').map((x) => x.source)).toEqual(['ts', 'eslint']);
    store.getState().clearSource('ts');
    expect(fileDiagnostics(store.getState(), 'p', 'a.js').map((x) => x.source)).toEqual(['eslint']);
    store.getState().set('p', 'a.js', 'eslint', []);
    expect(store.getState().byProject.p).toEqual({});
  });

  it('converts between offsets and 1-based lines and columns', () => {
    const text = 'ab\ncde\n\nf';
    const starts = lineStarts(text);
    expect(offsetAt(starts, text, 2, 2)).toBe(4);
    expect(positionAt(starts, 4)).toEqual({ line: 2, column: 2 });
    expect(offsetAt(starts, text, 2, 99)).toBe(6);
    expect(positionAt(starts, text.length)).toEqual({ line: 4, column: 2 });
  });
});

describe('themes pack', () => {
  it('uses six-digit hex colors, which the editor adds alpha to', () => {
    for (const t of colorThemes) {
      const colors = [...Object.values(t.editor).filter((v) => typeof v === 'string'), ...Object.values(t.editor.syntax), ...Object.values(t.terminal)];
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('picks file icons by name, then extension', () => {
    expect(fileIconFor('package.json')).toMatchObject({ kind: 'icon', name: 'package' });
    expect(fileIconFor('app.TSX')).toMatchObject({ kind: 'label', text: 'TSX' });
    expect(fileIconFor('.env.local')).toMatchObject({ name: 'key' });
    expect(fileIconFor('Makefile')).toBeNull();
  });
});
