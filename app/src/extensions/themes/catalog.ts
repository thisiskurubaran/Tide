// Themes in the Themes & Icons Pack. Each one colors the editor and the
// terminal; the app's own screens keep the FuseOps palette. Colors are the
// themes' published palettes, as six-digit hex (the editor adds alpha to some).
import type { EditorTheme } from '../../theme/editor';
import type { TerminalTheme } from '../../theme/terminal';

export interface ColorTheme {
  id: string;
  name: string;
  dark: boolean;
  editor: EditorTheme;
  terminal: TerminalTheme;
}

interface Palette {
  bg: string;
  fg: string;
  // Active line, tooltips and panels.
  raised: string;
  selection: string;
  gutter: string;
  border: string;
  comment: string;
  red: string;
  orange: string;
  yellow: string;
  green: string;
  cyan: string;
  blue: string;
  purple: string;
  // Syntax roles, picked per theme so each looks like its original.
  keyword: string;
  string: string;
  number: string;
  fn: string;
  type: string;
  property?: string;
  operator?: string;
  // ANSI black/white and their bright versions.
  black: string;
  white: string;
  brightBlack: string;
  brightWhite: string;
}

function theme(id: string, name: string, dark: boolean, p: Palette): ColorTheme {
  return {
    id,
    name,
    dark,
    editor: {
      background: p.bg,
      foreground: p.fg,
      caret: p.fg,
      selection: p.selection,
      activeLine: p.raised,
      gutterBackground: p.bg,
      gutterForeground: p.gutter,
      gutterBorder: p.border,
      matchingBracket: p.selection,
      syntax: {
        keyword: p.keyword,
        string: p.string,
        number: p.number,
        comment: p.comment,
        function: p.fn,
        type: p.type,
        property: p.property ?? p.fg,
        operator: p.operator ?? p.fg,
        punctuation: p.fg,
        invalid: p.red,
      },
    },
    terminal: {
      background: p.bg,
      foreground: p.fg,
      cursor: p.fg,
      cursorAccent: p.bg,
      selectionBackground: p.selection,
      black: p.black,
      red: p.red,
      green: p.green,
      yellow: p.yellow,
      blue: p.blue,
      magenta: p.purple,
      cyan: p.cyan,
      white: p.white,
      brightBlack: p.brightBlack,
      brightRed: p.red,
      brightGreen: p.green,
      brightYellow: p.yellow,
      brightBlue: p.blue,
      brightMagenta: p.purple,
      brightCyan: p.cyan,
      brightWhite: p.brightWhite,
    },
  };
}

export const colorThemes: ColorTheme[] = [
  theme('dracula', 'Dracula', true, {
    bg: '#282a36',
    fg: '#f8f8f2',
    raised: '#343746',
    selection: '#44475a',
    gutter: '#6272a4',
    border: '#3a3c4e',
    comment: '#6272a4',
    red: '#ff5555',
    orange: '#ffb86c',
    yellow: '#f1fa8c',
    green: '#50fa7b',
    cyan: '#8be9fd',
    blue: '#bd93f9',
    purple: '#ff79c6',
    keyword: '#ff79c6',
    string: '#f1fa8c',
    number: '#bd93f9',
    fn: '#50fa7b',
    type: '#8be9fd',
    operator: '#ff79c6',
    black: '#21222c',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightWhite: '#ffffff',
  }),
  theme('one-dark', 'One Dark', true, {
    bg: '#282c34',
    fg: '#abb2bf',
    raised: '#2c313c',
    selection: '#3e4451',
    gutter: '#636d83',
    border: '#3b4048',
    comment: '#7f848e',
    red: '#e06c75',
    orange: '#d19a66',
    yellow: '#e5c07b',
    green: '#98c379',
    cyan: '#56b6c2',
    blue: '#61afef',
    purple: '#c678dd',
    keyword: '#c678dd',
    string: '#98c379',
    number: '#d19a66',
    fn: '#61afef',
    type: '#e5c07b',
    property: '#e06c75',
    operator: '#56b6c2',
    black: '#3f4451',
    white: '#d7dae0',
    brightBlack: '#4f5666',
    brightWhite: '#e6e6e6',
  }),
  theme('monokai', 'Monokai', true, {
    bg: '#272822',
    fg: '#f8f8f2',
    raised: '#3e3d32',
    selection: '#49483e',
    gutter: '#90908a',
    border: '#3b3a32',
    comment: '#88846f',
    red: '#f92672',
    orange: '#fd971f',
    yellow: '#e6db74',
    green: '#a6e22e',
    cyan: '#66d9ef',
    blue: '#66d9ef',
    purple: '#ae81ff',
    keyword: '#f92672',
    string: '#e6db74',
    number: '#ae81ff',
    fn: '#a6e22e',
    type: '#66d9ef',
    operator: '#f92672',
    black: '#272822',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightWhite: '#f9f8f5',
  }),
  theme('nord', 'Nord', true, {
    bg: '#2e3440',
    fg: '#d8dee9',
    raised: '#3b4252',
    selection: '#434c5e',
    gutter: '#616e88',
    border: '#3b4252',
    comment: '#616e88',
    red: '#bf616a',
    orange: '#d08770',
    yellow: '#ebcb8b',
    green: '#a3be8c',
    cyan: '#88c0d0',
    blue: '#81a1c1',
    purple: '#b48ead',
    keyword: '#81a1c1',
    string: '#a3be8c',
    number: '#b48ead',
    fn: '#88c0d0',
    type: '#8fbcbb',
    operator: '#81a1c1',
    black: '#3b4252',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightWhite: '#eceff4',
  }),
  theme('solarized-dark', 'Solarized Dark', true, {
    bg: '#002b36',
    fg: '#839496',
    raised: '#073642',
    selection: '#0a4251',
    gutter: '#586e75',
    border: '#073642',
    comment: '#586e75',
    red: '#dc322f',
    orange: '#cb4b16',
    yellow: '#b58900',
    green: '#859900',
    cyan: '#2aa198',
    blue: '#268bd2',
    purple: '#d33682',
    keyword: '#859900',
    string: '#2aa198',
    number: '#d33682',
    fn: '#268bd2',
    type: '#b58900',
    black: '#073642',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightWhite: '#fdf6e3',
  }),
  theme('solarized-light', 'Solarized Light', false, {
    bg: '#fdf6e3',
    fg: '#657b83',
    raised: '#eee8d5',
    selection: '#e4dcc4',
    gutter: '#93a1a1',
    border: '#eee8d5',
    comment: '#93a1a1',
    red: '#dc322f',
    orange: '#cb4b16',
    yellow: '#b58900',
    green: '#859900',
    cyan: '#2aa198',
    blue: '#268bd2',
    purple: '#d33682',
    keyword: '#859900',
    string: '#2aa198',
    number: '#d33682',
    fn: '#268bd2',
    type: '#b58900',
    black: '#073642',
    white: '#657b83',
    brightBlack: '#586e75',
    brightWhite: '#002b36',
  }),
  theme('github-light', 'GitHub Light', false, {
    bg: '#ffffff',
    fg: '#24292f',
    raised: '#f6f8fa',
    selection: '#cde4fb',
    gutter: '#8c959f',
    border: '#d0d7de',
    comment: '#6e7781',
    red: '#cf222e',
    orange: '#953800',
    yellow: '#9a6700',
    green: '#116329',
    cyan: '#1b7c83',
    blue: '#0969da',
    purple: '#8250df',
    keyword: '#cf222e',
    string: '#0a3069',
    number: '#0550ae',
    fn: '#8250df',
    type: '#953800',
    property: '#0550ae',
    black: '#24292f',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightWhite: '#1f2328',
  }),
];

export const colorThemeFor = (id: string | null) => (id ? colorThemes.find((t) => t.id === id) ?? null : null);
