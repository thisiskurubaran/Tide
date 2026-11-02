import { Platform } from 'react-native';
import { useStore } from 'zustand';

import { storage } from '../../state';
import { createFakeTips, createStoreTips } from './purchases';
import { createTipsStore, TipsState } from './tips';

// The web build has no store; tips there go through a fake, for screenshots.
const purchases = Platform.OS === 'web' ? createFakeTips() : createStoreTips();
export const tipsStore = createTipsStore(storage, purchases);
export const useTips = <T>(selector: (s: TipsState) => T) => useStore(tipsStore, selector);

// Finishes tips the store replays at launch (e.g. approved through Ask to Buy).
export function startTips(): void {
  purchases.start().catch(() => undefined);
}
