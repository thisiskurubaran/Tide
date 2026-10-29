/**
 * @jest-environment node
 */
/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { manifests } from '../../extensions/manifests';
import { PLANS } from './plans';

// The StoreKit configuration for testing in Xcode lists exactly what the app sells.
it('matches the products the app sells', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../storekit/Tide.storekit'), 'utf8'));
  const oneTime = config.products.map((p: { productID: string; displayPrice: string }) => [p.productID, `$${p.displayPrice}`]);
  const subs = config.subscriptionGroups[0].subscriptions.map((p: { productID: string; displayPrice: string }) => [p.productID, `$${p.displayPrice}`]);
  const sold = [...manifests.map((m) => [m.productId, m.fallbackPrice]), ...PLANS.map((p) => [p.productId, p.fallbackPrice])];
  expect([...oneTime, ...subs].sort()).toEqual(sold.sort());
  const yearly = config.subscriptionGroups[0].subscriptions.find((s: { productID: string }) => s.productID.endsWith('.yearly'));
  expect(yearly.introductoryOffer).toMatchObject({ paymentMode: 'free', subscriptionPeriod: 'P1W' });
});
