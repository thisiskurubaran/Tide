// Messages between the app and the diff WebView (web/diff).
import type { EditorTheme } from '../../theme/editor';
import type { Language } from '../editor/bridge';

export type DiffLayout = 'unified' | 'split';

export type ToDiff =
  | {
      type: 'show';
      // Left / removed side, and the side that can be edited.
      original: string;
      modified: string;
      language: Language;
      layout: DiffLayout;
      editable: boolean;
      // Unified layout: buttons on each change to keep it (accept) or go
      // back to the original (reject), with these labels; null for none.
      controls: { accept: string; reject: string } | null;
    }
  | { type: 'setTheme'; theme: EditorTheme; dark: boolean; fontSize: number }
  | { type: 'next' }
  | { type: 'prev' };

export type FromDiff =
  | { type: 'ready' }
  | { type: 'change'; content: string }
  // How many changed regions are left.
  | { type: 'chunks'; count: number }
  | { type: 'error'; message: string };

export function parseFromDiff(raw: string): FromDiff | null {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg.type === 'string' ? (msg as FromDiff) : null;
  } catch {
    return null;
  }
}
