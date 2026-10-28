import { ColorScheme, extended, palette } from './tokens';

// Plain data so the CodeMirror bundle (Phase 2) can build its theme and
// highlight style from it without importing React Native code.
export interface EditorTheme {
  background: string;
  foreground: string;
  caret: string;
  selection: string;
  activeLine: string;
  gutterBackground: string;
  gutterForeground: string;
  gutterBorder: string;
  matchingBracket: string;
  syntax: {
    keyword: string;
    string: string;
    number: string;
    comment: string;
    function: string;
    type: string;
    property: string;
    operator: string;
    punctuation: string;
    invalid: string;
  };
}

function build(scheme: ColorScheme): EditorTheme {
  const c = palette[scheme];
  const x = extended[scheme];
  return {
    background: c.background,
    foreground: c.foreground,
    caret: c.foreground,
    selection: c.brandSoft,
    activeLine: c.card,
    gutterBackground: c.background,
    gutterForeground: x.dim,
    gutterBorder: c.border,
    matchingBracket: c.secondary,
    syntax: {
      keyword: c.brand,
      string: c.success,
      number: c.warning,
      comment: x.dim,
      function: x.cyan,
      type: x.magenta,
      property: c.foreground,
      operator: c.mutedForeground,
      punctuation: c.mutedForeground,
      invalid: c.destructive,
    },
  };
}

export const editorThemes: Record<ColorScheme, EditorTheme> = {
  dark: build('dark'),
  light: build('light'),
};
