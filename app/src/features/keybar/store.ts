import { createStore, useStore } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';

import { storage } from '../../state';
import type { Language } from '../editor/bridge';
import { DEFAULT_EDITOR_KEYS, DEFAULT_TERMINAL_KEYS } from './catalog';

export type EditorLayout = 'default' | Language;

export interface KeyBarState {
  // 'default' applies to every language without its own list.
  editor: Partial<Record<EditorLayout, string[]>>;
  terminal: string[];
  setEditor(layout: EditorLayout, keys: string[] | null): void;
  setTerminal(keys: string[] | null): void;
}

export function editorKeys(s: Pick<KeyBarState, 'editor'>, language: Language): string[] {
  return s.editor[language] ?? s.editor.default ?? DEFAULT_EDITOR_KEYS;
}

export function createKeyBarStore(s: StateStorage) {
  return createStore<KeyBarState>()(
    persist(
      (set) => ({
        editor: {},
        terminal: DEFAULT_TERMINAL_KEYS,
        // null goes back to the default (or, for a language, to the default list).
        setEditor: (layout, keys) =>
          set((st) => {
            const editor = { ...st.editor };
            if (keys) editor[layout] = keys;
            else delete editor[layout];
            return { editor };
          }),
        setTerminal: (keys) => set({ terminal: keys ?? DEFAULT_TERMINAL_KEYS }),
      }),
      { name: 'keybar', version: 1, storage: createJSONStorage(() => s), partialize: ({ editor, terminal }) => ({ editor, terminal }) },
    ),
  );
}

export const keyBarStore = createKeyBarStore(storage);
export const useKeyBar = <T>(selector: (s: KeyBarState) => T) => useStore(keyBarStore, selector);
