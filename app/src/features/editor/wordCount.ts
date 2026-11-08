import { useMemo } from 'react';

import { useBuffers } from '../../state';
import { bufferKey } from '../../state/buffers';
import { languageFor } from './bridge';
import { LARGE_CHARS } from './largeFiles';
import { useEditorSelection } from './selection';

// Average silent reading speed, in words per minute.
export const WORDS_PER_MINUTE = 230;

// Words in Markdown text: link targets, HTML tags and markup characters don't
// count; each CJK character counts as a word, as word processors do.
export function countWords(text: string): number {
  const prose = text
    // [label](url) and ![alt](src): keep the label.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  const cjk = prose.match(/[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g)?.length ?? 0;
  const words = prose.replace(/[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g, ' ').match(/[\p{L}\p{N}](?:[\p{L}\p{N}_'’.-]*[\p{L}\p{N}])?/gu)?.length ?? 0;
  return words + cjk;
}

const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// "1,234 words · 6 min". Under a minute rounds up to 1 min, nothing is "0 min".
export function wordCountLabel(words: number): string {
  const minutes = words === 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return `${grouped(words)} ${words === 1 ? 'word' : 'words'} · ${minutes} min`;
}

// The status bar's word count for a Markdown file: the selection's when
// there is one, else the whole file's. null for other files.
export function useMarkdownWordCount(project: string, path: string | null): string | null {
  const markdown = path !== null && languageFor(path) === 'markdown';
  const content = useBuffers((s) => (markdown && path ? s.buffers[bufferKey(project, path)]?.content : undefined));
  const range = useEditorSelection((s) => (markdown && s.project === project && s.path === path && s.anchor !== s.head ? `${Math.min(s.anchor, s.head)}:${Math.max(s.anchor, s.head)}` : null));
  return useMemo(() => {
    if (content === undefined || content.length > LARGE_CHARS) return null;
    let text = content;
    if (range) {
      const [from, to] = range.split(':').map(Number);
      text = content.slice(from, to);
    }
    return wordCountLabel(countWords(text));
  }, [content, range]);
}
