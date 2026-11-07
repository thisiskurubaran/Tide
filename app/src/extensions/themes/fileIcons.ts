// File icons by name and extension: a short colored label for languages, a
// colored Feather icon for everything else. Colors follow each language's
// usual brand color, darkened where needed to read on light backgrounds.
export type FileIcon = { kind: 'label'; text: string; color: string } | { kind: 'icon'; name: string; color: string };

const label = (text: string, color: string): FileIcon => ({ kind: 'label', text, color });
const icon = (name: string, color: string): FileIcon => ({ kind: 'icon', name, color });

const BY_NAME: Record<string, FileIcon> = {
  'package.json': icon('package', '#cb3837'),
  'package-lock.json': icon('lock', '#cb3837'),
  'tide.json': icon('settings', '#2dd4bf'),
  'tsconfig.json': icon('settings', '#3178c6'),
  'requirements.txt': icon('list', '#3776ab'),
  'dockerfile': icon('box', '#2496ed'),
  '.gitignore': icon('git-branch', '#f05033'),
  '.gitattributes': icon('git-branch', '#f05033'),
  '.env': icon('key', '#c9a227'),
  'license': icon('award', '#c9a227'),
  'readme.md': icon('book-open', '#519aba'),
};

const BY_EXTENSION: Record<string, FileIcon> = {
  js: label('JS', '#c9a227'),
  mjs: label('JS', '#c9a227'),
  cjs: label('JS', '#c9a227'),
  jsx: label('JSX', '#149eca'),
  ts: label('TS', '#3178c6'),
  mts: label('TS', '#3178c6'),
  cts: label('TS', '#3178c6'),
  tsx: label('TSX', '#3178c6'),
  py: label('PY', '#3776ab'),
  json: label('{}', '#c9a227'),
  html: label('<>', '#e34c26'),
  htm: label('<>', '#e34c26'),
  css: label('#', '#663399'),
  scss: label('#', '#c6538c'),
  less: label('#', '#1d365d'),
  md: label('MD', '#519aba'),
  markdown: label('MD', '#519aba'),
  yml: label('YML', '#cb171e'),
  yaml: label('YML', '#cb171e'),
  sh: icon('terminal', '#4eaa25'),
  bash: icon('terminal', '#4eaa25'),
  txt: icon('file-text', '#8c959f'),
  csv: icon('grid', '#1d6f42'),
  svg: icon('image', '#ffb13b'),
  png: icon('image', '#a074c4'),
  jpg: icon('image', '#a074c4'),
  jpeg: icon('image', '#a074c4'),
  gif: icon('image', '#a074c4'),
  webp: icon('image', '#a074c4'),
  sql: icon('database', '#e38c00'),
  db: icon('database', '#e38c00'),
  sqlite: icon('database', '#e38c00'),
  lock: icon('lock', '#8c959f'),
  zip: icon('archive', '#8c959f'),
};

export function fileIconFor(name: string): FileIcon | null {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith('.env')) return BY_NAME['.env'];
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? (BY_EXTENSION[lower.slice(dot + 1)] ?? null) : null;
}
