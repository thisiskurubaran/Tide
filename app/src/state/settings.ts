import { createStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { ALL_GESTURES, type CodeFont, DEFAULT_CODE_FONT, type EditorGestures, type KeymapSetting, type Snippet } from '../features/editor/bridge';

export type { CodeFont };

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
  // Emmet in HTML, CSS and JSX, and the user's own snippets.
  emmet: boolean;
  snippets: Snippet[];
  // The first problem on a line, shown at its end (error lens).
  errorLens: boolean;
  haptics: boolean;
  // "system" follows the device's Increase Contrast setting.
  contrast: ContrastSetting;
  // Font for the editor and terminal, and whether its ligatures (=> != >=) show.
  codeFont: CodeFont;
  ligatures: boolean;
  // The app's own colors follow the Themes & Icons color theme, when one is chosen.
  matchChrome: boolean;
  // Runs, tests and deploys on the Lock Screen and in the Dynamic Island (iOS).
  liveActivities: boolean;
  setLiveActivities(on: boolean): void;
  // Touch gestures in the editor (Settings > Gestures).
  gestures: EditorGestures;
  setGesture(key: keyof EditorGestures, on: boolean): void;
  setTheme(theme: ThemeSetting): void;
  setEditorFontSize(size: number): void;
  setTerminalFontSize(size: number): void;
  setCrashReports(on: boolean): void;
  setEditorOption(key: EditorOptionKey, on: boolean): void;
  setKeymap(keymap: KeymapSetting): void;
  setSnippets(snippets: Snippet[]): void;
  setHaptics(on: boolean): void;
  setContrast(contrast: ContrastSetting): void;
  setMatchChrome(on: boolean): void;
  setCodeFont(font: CodeFont): void;
  setLigatures(on: boolean): void;
}

export type ContrastSetting = 'system' | 'standard' | 'high';

export type EditorOptionKey = 'wordWrap' | 'folding' | 'indentGuides' | 'minimap' | 'emmet' | 'errorLens';

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
        errorLens: true,
        haptics: true,
        contrast: 'system',
        codeFont: DEFAULT_CODE_FONT,
        ligatures: false,
        matchChrome: true,
        liveActivities: true,
        setLiveActivities: (liveActivities) => set({ liveActivities }),
        gestures: ALL_GESTURES,
        // Merged with the defaults, so a gesture added later starts on for settings saved before it.
        setGesture: (key, on) => set((s) => ({ gestures: { ...ALL_GESTURES, ...s.gestures, [key]: on } })),
        setTheme: (theme) => set({ theme }),
        setEditorFontSize: (size) => set({ editorFontSize: clampFontSize(size) }),
        setTerminalFontSize: (size) => set({ terminalFontSize: clampFontSize(size) }),
        setCrashReports: (crashReports) => set({ crashReports }),
        setEditorOption: (key, on) => set({ [key]: on }),
        setKeymap: (keymap) => set({ keymap }),
        setSnippets: (snippets) => set({ snippets }),
        setHaptics: (haptics) => set({ haptics }),
        setContrast: (contrast) => set({ contrast }),
        setMatchChrome: (matchChrome) => set({ matchChrome }),
        setCodeFont: (codeFont) => set({ codeFont }),
        setLigatures: (ligatures) => set({ ligatures }),
      }),
      {
        name: 'settings',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ theme, editorFontSize, terminalFontSize, crashReports, wordWrap, folding, indentGuides, minimap, keymap, emmet, snippets, errorLens, haptics, contrast, codeFont, ligatures, matchChrome, gestures, liveActivities }) => ({
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
          errorLens,
          haptics,
          contrast,
          codeFont,
          ligatures,
          matchChrome,
          liveActivities,
          gestures,
        }),
      },
    ),
  );
}
