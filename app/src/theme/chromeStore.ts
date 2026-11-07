import { createStore, useStore } from 'zustand';

import type { ColorTheme } from '../extensions/themes/catalog';

// The color theme the app chrome may follow: the Themes & Icons pick while the
// pack is installed, else null. extensions/state.ts keeps it in sync, so the
// theme layer reads it without importing the extensions (which import theme).
export const chromeThemeStore = createStore<{ theme: ColorTheme | null }>(() => ({ theme: null }));

export const useChosenColorTheme = () => useStore(chromeThemeStore, (s) => s.theme);
