// Emmet abbreviations (ul>li*3, .card>h2+p, m10) expanded with Tab
// in HTML, CSS and JSX.
import { Extension, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { abbreviationTracker, EmmetKnownSyntax, emmetConfig, expandAbbreviation } from '@emmetio/codemirror6-plugin';

import type { Language } from '../../src/features/editor/bridge';

const EMMET: Partial<Record<Language, EmmetKnownSyntax>> = {
  html: EmmetKnownSyntax.html,
  php: EmmetKnownSyntax.html,
  css: EmmetKnownSyntax.css,
  jsx: EmmetKnownSyntax.jsx,
  tsx: EmmetKnownSyntax.tsx,
};

export function emmetExtension(lang: Language): Extension[] {
  const syntax = EMMET[lang];
  if (!syntax) return [];
  return [
    emmetConfig.of({ syntax, previewEnabled: false }),
    abbreviationTracker(),
    // Tab expands an abbreviation; when there isn't one it does what it did before.
    Prec.high(keymap.of([{ key: 'Tab', run: expandAbbreviation }])),
  ];
}
