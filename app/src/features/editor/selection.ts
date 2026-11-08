import { createStore, useStore } from 'zustand';

// The editor's latest selection (from its debounced 'cursor' messages). Its
// own store, so a cursor move re-renders only what reads it: the Markdown
// word count in the status bar, and the autosave that leaves the line being
// typed on untrimmed. anchor === head means nothing is selected.
export interface EditorSelection {
  project: string | null;
  path: string | null;
  anchor: number;
  head: number;
}

export const selectionStore = createStore<EditorSelection>(() => ({ project: null, path: null, anchor: 0, head: 0 }));

export const useEditorSelection = <T>(sel: (s: EditorSelection) => T) => useStore(selectionStore, sel);
