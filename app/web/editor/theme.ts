import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

import type { EditorTheme } from '../../src/theme/editor';
import { SHAPES } from './problems';

// A CSS variable so a 'setFont' message can swap the font without rebuilding
// the theme. Starts as JetBrains Mono, the default.
export const FONT_FAMILY = "var(--tide-code-font, 'JetBrains Mono'), monospace";

// #rrggbb plus an alpha byte; themes use six-digit hex colors.
const alpha = (hex: string, a: number) => (/^#[0-9a-f]{6}$/i.test(hex) ? hex + Math.round(a * 255).toString(16).padStart(2, '0') : hex);

// Problems read by shape as well as color: ✕ ▲ ● in the gutter, the lens and
// the tooltip, and wavy / dashed / dotted underlines (lint's default is one
// wavy line for every severity).
function problemStyles(theme: EditorTheme) {
  const s = theme.syntax;
  const color = { error: s.invalid, warning: s.number, info: s.function } as const;
  const line = { error: 'wavy', warning: 'dashed', info: 'dotted' } as const;
  const out: Record<string, Record<string, string>> = {
    '.cm-lintRange': { backgroundImage: 'none', paddingBottom: '0', textDecorationLine: 'underline', textDecorationSkipInk: 'none', textUnderlineOffset: '3px', textDecorationThickness: '1.5px' },
    '.cm-problem-gutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px', minWidth: '12px', cursor: 'pointer' },
    '.cm-problem-marker': { fontSize: '0.75em', lineHeight: '1', fontFamily: 'system-ui, sans-serif' },
    '.cm-gutterElement[style*="visibility: hidden"] .cm-problem-marker': { visibility: 'hidden' },
    '.cm-error-lens': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      marginLeft: '2ch',
      padding: '0 6px',
      borderRadius: '4px',
      maxWidth: 'min(48ch, 55vw)',
      verticalAlign: 'top',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '0.8em',
      lineHeight: '1.6',
      color: theme.gutterForeground,
      cursor: 'pointer',
    },
    '.cm-error-lens-shape': { flex: 'none', fontSize: '0.85em' },
    '.cm-error-lens-text': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: '0' },
    // "✦ Fix" with AI, in Tide's teal.
    '.cm-error-lens-fix': { flex: 'none', marginLeft: '4px', padding: '0 6px', borderRadius: '999px', color: '#14b8a6', backgroundColor: alpha('#14b8a6', 0.16), fontWeight: '600', cursor: 'pointer' },
    '.cm-diagnosticText::before': { marginRight: '6px' },
    // Peek definition.
    '.cm-peek': {
      margin: '4px 8px 6px 0',
      border: `1px solid ${s.keyword}`,
      borderRadius: '8px',
      backgroundColor: theme.activeLine,
      overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif',
    },
    '.cm-peek-header': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 6px 3px 8px',
      borderBottom: `1px solid ${theme.gutterBorder}`,
      fontSize: '0.8em',
      color: theme.foreground,
    },
    '.cm-peek-icon': { display: 'flex', color: theme.gutterForeground },
    '.cm-peek-title': { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    '.cm-peek-header button': {
      background: 'none',
      border: 'none',
      padding: '2px 6px',
      minHeight: '24px',
      color: s.function,
      fontSize: '1em',
      fontFamily: 'inherit',
      cursor: 'pointer',
    },
    '.cm-peek-close': { color: `${theme.gutterForeground} !important`, fontSize: '1.2em !important' },
    // About 8 lines, then it scrolls. The page's 14px rule would otherwise beat the zoomed size.
    '.cm-peek-body .cm-editor': { maxHeight: '12em', height: 'auto', fontSize: '0.95em', backgroundColor: theme.activeLine },
    '.cm-peek-body .cm-scroller': { overflow: 'auto' },
    '.cm-peek-body .cm-gutters': { backgroundColor: theme.activeLine },
    '.cm-peek-target': { backgroundColor: alpha(s.keyword, 0.14) },
  };
  for (const sev of ['error', 'warning', 'info'] as const) {
    out[`.cm-lintRange-${sev}`] = { textDecorationStyle: line[sev], textDecorationColor: color[sev] };
    out[`.cm-problem-${sev}`] = { color: color[sev] };
    out[`.cm-error-lens-${sev}`] = { backgroundColor: alpha(color[sev], 0.12) };
    out[`.cm-error-lens-${sev} .cm-error-lens-shape`] = { color: color[sev] };
    out[`.cm-diagnostic-${sev} .cm-diagnosticText::before`] = { content: `"${SHAPES[sev]}"`, color: color[sev] };
  }
  return out;
}

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
      '.cm-foldGutter .cm-gutterElement': { color: theme.gutterForeground, padding: '0 4px', cursor: 'pointer' },
      '.cm-foldPlaceholder': { backgroundColor: theme.activeLine, border: `1px solid ${theme.gutterBorder}`, color: theme.gutterForeground, padding: '0 4px' },
      '.cm-minimap-gutter': { borderLeft: `1px solid ${theme.gutterBorder}` },
      '.cm-tooltip-hover, .cm-tooltip-lint': { maxWidth: '90vw', fontSize: '0.9em' },
      '.cm-tide-hover pre': { margin: 0, padding: '4px 8px', whiteSpace: 'pre-wrap', fontFamily: FONT_FAMILY, color: s.type },
      '.cm-tide-hover-doc': { padding: '4px 8px', borderTop: `1px solid ${theme.gutterBorder}`, whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif' },
      '.cm-tooltip.cm-completionInfo': { fontFamily: 'system-ui, sans-serif', whiteSpace: 'pre-wrap', maxWidth: '60vw' },
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
      ...problemStyles(theme),
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
