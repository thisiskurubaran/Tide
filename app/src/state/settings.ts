import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import type { KeymapSetting, Snippet } from '../features/editor/bridge';

export type ThemeSetting = 'system' | 'light' | 'dark';

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const clampFontSize = (n: number) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n)));

export interface SettingsState {
  theme: ThemeSetting;
  editorFontSize: number;
  terminalFontSize: number;
  // Off by default. Has no effect in builds without a Sentry DSN.
  crashReports: boolean;
  // Editor view options. Wrapping is on because phone screens are narrow.
  wordWrap: boolean;
  folding: boolean;
  indentGuides: boolean;
  minimap: boolean;
  // Vim or Emacs key bindings in the editor, mostly for hardware keyboards.
  keymap: KeymapSetting;
  // Tide Pro: Emmet in HTML, CSS and JSX, and the user's own snippets.
  emmet: boolean;
  snippets: Snippet[];
  haptics: boolean;
  // "system" follows the device's Increase Contrast setting.
  contrast: ContrastSetting;
  setTheme(theme: ThemeSetting): void;
  setEditorFontSize(size: number): void;
  setTerminalFontSize(size: number): void;
  setCrashReports(on: boolean): void;
  setEditorOption(key: EditorOptionKey, on: boolean): void;
  setKeymap(keymap: KeymapSetting): void;
  setSnippets(snippets: Snippet[]): void;
  setHaptics(on: boolean): void;
  setContrast(contrast: ContrastSetting): void;
}

export type ContrastSetting = 'system' | 'standard' | 'high';

export type EditorOptionKey = 'wordWrap' | 'folding' | 'indentGuides' | 'minimap' | 'emmet';

export function createSettingsStore(storage: StateStorage) {
  return createStore<SettingsState>()(
    persist(
      (set) => ({
        theme: 'dark',
        editorFontSize: 14,
        terminalFontSize: 13,
        crashReports: false,
        wordWrap: true,
        folding: true,
        indentGuides: true,
        minimap: false,
        keymap: 'standard',
        emmet: true,
        snippets: [],
        haptics: true,
        contrast: 'system',
        setTheme: (theme) => set({ theme }),
        setEditorFontSize: (size) => set({ editorFontSize: clampFontSize(size) }),
        setTerminalFontSize: (size) => set({ terminalFontSize: clampFontSize(size) }),
        setCrashReports: (crashReports) => set({ crashReports }),
        setEditorOption: (key, on) => set({ [key]: on }),
        setKeymap: (keymap) => set({ keymap }),
        setSnippets: (snippets) => set({ snippets }),
        setHaptics: (haptics) => set({ haptics }),
        setContrast: (contrast) => set({ contrast }),
      }),
      {
        name: 'settings',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ theme, editorFontSize, terminalFontSize, crashReports, wordWrap, folding, indentGuides, minimap, keymap, emmet, snippets, haptics, contrast }) => ({
          theme,
          editorFontSize,
          terminalFontSize,
          crashReports,
          wordWrap,
          folding,
          indentGuides,
          minimap,
          keymap,
          emmet,
          snippets,
          haptics,
          contrast,
        }),
      },
    ),
  );
}
