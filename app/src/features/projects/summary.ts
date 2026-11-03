import { fileBadge } from '../../components/FileBadge';

// What a project card shows about a project's files: the main language's
// badge and the languages in it, most files first ("HTML · CSS · JS").
export interface LanguageSummary {
  badge: { text: string; color: string } | null;
  languages: string[];
}

// Names by FileBadge label. Config, images and .http files aren't languages.
const NAMES: Record<string, string> = {
  '<>': 'HTML',
  '#': 'CSS',
  TS: 'TS',
  JS: 'JS',
  '{}': 'JSON',
  'M↓': 'Markdown',
  Py: 'Python',
  Rb: 'Ruby',
  php: 'PHP',
  Lua: 'Lua',
  $: 'Shell',
  DB: 'SQL',
  '▦': 'Data',
};
// Every project has a package.json or README; they only lead when nothing else is there.
const SUPPORTING = new Set(['{}', 'M↓', '▦']);

export function summarizeLanguages(paths: string[], max = 3): LanguageSummary {
  const counts = new Map<string, { n: number; badge: { text: string; color: string } }>();
  for (const path of paths) {
    const badge = fileBadge(path.split('/').pop() ?? path);
    if (!badge || !NAMES[badge.text]) continue;
    const hit = counts.get(badge.text);
    if (hit) hit.n++;
    else counts.set(badge.text, { n: 1, badge });
  }
  const ranked = [...counts.values()].sort((a, b) => Number(SUPPORTING.has(a.badge.text)) - Number(SUPPORTING.has(b.badge.text)) || b.n - a.n);
  return { badge: ranked[0]?.badge ?? null, languages: ranked.slice(0, max).map((c) => NAMES[c.badge.text]) };
}
