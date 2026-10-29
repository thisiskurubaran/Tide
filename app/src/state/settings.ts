import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

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
  haptics: boolean;
  setTheme(theme: ThemeSetting): void;
  setEditorFontSize(size: number): void;
  setTerminalFontSize(size: number): void;
  setCrashReports(on: boolean): void;
  setEditorOption(key: EditorOptionKey, on: boolean): void;
  setHaptics(on: boolean): void;
}

export type EditorOptionKey = 'wordWrap' | 'folding' | 'indentGuides' | 'minimap';

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
        haptics: true,
        setTheme: (theme) => set({ theme }),
        setEditorFontSize: (size) => set({ editorFontSize: clampFontSize(size) }),
        setTerminalFontSize: (size) => set({ terminalFontSize: clampFontSize(size) }),
        setCrashReports: (crashReports) => set({ crashReports }),
        setEditorOption: (key, on) => set({ [key]: on }),
        setHaptics: (haptics) => set({ haptics }),
      }),
      {
        name: 'settings',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ theme, editorFontSize, terminalFontSize, crashReports, wordWrap, folding, indentGuides, minimap, haptics }) => ({
          theme,
          editorFontSize,
          terminalFontSize,
          crashReports,
          wordWrap,
          folding,
          indentGuides,
          minimap,
          haptics,
        }),
      },
    ),
  );
}
