// Editor view options the user picks in Settings: word wrap, the fold gutter,
// indent guides, the minimap and Vim or Emacs key bindings.
import { foldGutter, foldKeymap, codeFolding } from '@codemirror/language';
import { Extension, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { showMinimap } from '@replit/codemirror-minimap';
import { emacs } from '@replit/codemirror-emacs';
import { vim } from '@replit/codemirror-vim';

import { emmetExtension } from './emmet';

import type { EditorOptions, Language } from '../../src/features/editor/bridge';
import type { EditorTheme } from '../../src/theme/editor';

export function optionsExtension(options: EditorOptions, theme: EditorTheme | null, lang: Language = 'plain'): Extension[] {
  const out: Extension[] = [];
  if (options.emmet) out.push(...emmetExtension(lang));
  // Ahead of the default keymaps so Vim and Emacs keys win; app shortcuts (Cmd) still come first.
  if (options.keymap === 'vim') out.push(Prec.high(vim()));
  else if (options.keymap === 'emacs') out.push(Prec.high(emacs()));
  if (options.wordWrap) out.push(EditorView.lineWrapping);
  if (options.folding) {
    out.push(
      codeFolding({ placeholderText: '⋯' }),
      foldGutter({ openText: '⌄', closedText: '›' }),
      keymap.of(foldKeymap),
    );
  }
  if (options.indentGuides) {
    const inactive = theme?.gutterBorder ?? '#3a3c4e';
    const active = theme?.gutterForeground ?? '#6272a4';
    out.push(
      indentationMarkers({
        highlightActiveBlock: true,
        markerType: 'codeOnly',
        colors: { light: inactive, dark: inactive, activeLight: active, activeDark: active },
      }),
    );
  }
  if (options.minimap) {
    out.push(
      showMinimap.compute(['doc'], () => ({
        create: () => ({ dom: document.createElement('div') }),
        displayText: 'blocks',
        showOverlay: 'always',
      })),
    );
  }
  return out;
}
