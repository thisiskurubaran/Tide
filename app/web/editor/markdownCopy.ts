// "Copy selection as Markdown": a fenced code block with the language tag,
// under a header line with the file path and the lines it came from.
import type { EditorState } from '@codemirror/state';

import type { Language } from '../../src/features/editor/bridge';

// Fence tags GitHub and most renderers know; '' for plain text.
const FENCE: Partial<Record<Language, string>> = {
  javascript: 'js',
  typescript: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  python: 'python',
  markdown: 'markdown',
  shell: 'bash',
  powershell: 'powershell',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  objectivec: 'objectivec',
  csharp: 'csharp',
  cpp: 'cpp',
  env: 'dotenv',
  plain: '',
};

export const fenceLanguage = (lang: Language) => FENCE[lang] ?? lang;

export type LineSpan = { first: number; last: number };

// The main selection's text and lines (1-based), or the whole file with no lines.
export function copiedText(state: EditorState): { text: string; lines: LineSpan | null } {
  const r = state.selection.main;
  if (r.empty) return { text: state.doc.toString(), lines: null };
  const first = state.doc.lineAt(r.from).number;
  let last = state.doc.lineAt(r.to).number;
  if (last > first && state.doc.line(last).from === r.to) last--;
  return { text: state.sliceDoc(r.from, r.to), lines: { first, last } };
}

export function markdownBlock(path: string, lang: Language, text: string, lines: LineSpan | null): string {
  const where = lines ? (lines.first === lines.last ? ` (line ${lines.first})` : ` (lines ${lines.first}-${lines.last})`) : '';
  const body = text.replace(/\n$/, '');
  // Longer than any run of backticks inside, so the block can't end early.
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `**${path}**${where}\n\n${fence}${fenceLanguage(lang)}\n${body}\n${fence}\n`;
}
