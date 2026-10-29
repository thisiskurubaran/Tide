import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

import type { EditorTheme } from '../../src/theme/editor';

export const FONT_FAMILY = 'JetBrains Mono';

// #rrggbb plus an alpha byte; themes use six-digit hex colors.
const alpha = (hex: string, a: number) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex);

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
      '.cm-tooltip-hover, .cm-tooltip-lint': { maxWidth: '90vw', fontSize: '0.9em' },
      '.cm-tide-hover pre': { margin: 0, padding: '4px 8px', whiteSpace: 'pre-wrap', fontFamily: FONT_FAMILY, color: s.type },
      '.cm-tide-hover-doc': { padding: '4px 8px', borderTop: `1px solid ${theme.gutterBorder}`, whiteSpace: 'pre-wrap' },
      '.cm-breakpoint-gutter': { width: '14px', cursor: 'pointer' },
      '.cm-breakpoint-gutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center' },
      '.cm-breakpoint': { width: '9px', height: '9px', borderRadius: '50%', backgroundColor: s.invalid },
      // The spacer marker sizes the gutter; it shouldn't show a dot.
      '.cm-gutterElement[style*="visibility: hidden"] .cm-breakpoint': { visibility: 'hidden' },
      '.cm-execLine': { backgroundColor: alpha(s.number, 0.22), outline: `1px solid ${alpha(s.number, 0.5)}` },
      '.cm-conflict-current': { backgroundColor: alpha(s.string, 0.14) },
      '.cm-conflict-incoming': { backgroundColor: alpha(s.function, 0.14) },
      '.cm-conflict-base': { backgroundColor: alpha(s.comment, 0.12) },
      '.cm-conflict-marker': { color: s.comment, fontWeight: '600' },
      '.cm-conflict-actions': { display: 'flex', gap: '12px', padding: '2px 4px', fontFamily: 'system-ui, sans-serif' },
      '.cm-conflict-actions button': {
        background: 'none',
        border: 'none',
        padding: '2px 0',
        color: s.function,
        fontSize: '0.85em',
        cursor: 'pointer',
      },
      '.cm-diagnostic-error': { borderLeftColor: s.invalid },
      '.cm-diagnostic-warning': { borderLeftColor: s.number },
      '.cm-diagnostic-info': { borderLeftColor: s.function },
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
