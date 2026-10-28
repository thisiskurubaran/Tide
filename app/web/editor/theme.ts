import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

import type { EditorTheme } from '../../src/theme/editor';

export const FONT_FAMILY = 'JetBrains Mono';

export function buildTheme(theme: EditorTheme, dark: boolean) {
  const s = theme.syntax;
  const view = EditorView.theme(
    {
      '&': { color: theme.foreground, backgroundColor: theme.background, height: '100%' },
      '.cm-content': { caretColor: theme.caret, fontFamily: FONT_FAMILY },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: theme.caret, borderLeftWidth: '2px' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: theme.selection,
      },
      '.cm-activeLine': { backgroundColor: theme.activeLine },
      '.cm-gutters': { backgroundColor: theme.gutterBackground, color: theme.gutterForeground, borderRight: `1px solid ${theme.gutterBorder}` },
      '.cm-activeLineGutter': { backgroundColor: theme.activeLine, color: theme.foreground },
      '&.cm-focused .cm-matchingBracket': { backgroundColor: theme.matchingBracket, outline: `1px solid ${theme.gutterBorder}` },
      '.cm-tooltip': { backgroundColor: theme.activeLine, color: theme.foreground, border: `1px solid ${theme.gutterBorder}` },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: theme.selection, color: theme.foreground },
      '.cm-panels': { backgroundColor: theme.activeLine, color: theme.foreground },
      '.cm-panels input, .cm-panels button': { fontFamily: FONT_FAMILY, fontSize: '14px' },
      '.cm-searchMatch': { backgroundColor: theme.selection },
    },
    { dark },
  );
  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: s.keyword },
    { tag: [t.string, t.special(t.string), t.regexp], color: s.string },
    { tag: [t.number, t.bool, t.null, t.atom], color: s.number },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: s.comment, fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: s.function },
    { tag: [t.typeName, t.className, t.namespace, t.tagName], color: s.type },
    { tag: [t.propertyName, t.attributeName], color: s.property },
    { tag: [t.operator, t.derefOperator], color: s.operator },
    { tag: [t.punctuation, t.bracket, t.separator], color: s.punctuation },
    { tag: [t.heading], color: s.keyword, fontWeight: '600' },
    { tag: [t.link, t.url], color: s.function, textDecoration: 'underline' },
    { tag: t.invalid, color: s.invalid },
  ]);
  return [view, syntaxHighlighting(highlight)];
}
