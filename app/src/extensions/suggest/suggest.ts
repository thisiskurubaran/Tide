// "This project uses ESLint: install Format & Lint?" One extension at a time is
// offered when a project's files show it would help and it isn't installed;
// "Not now" stops offering it for that project.
import type { ExtensionId } from '../manifests';

export interface Suggestion {
  id: ExtensionId;
  reason: string;
}

export interface ProjectFacts {
  files: string[];
  // Dependency names from package.json, if any.
  dependencies: string[];
  isGitRepo: boolean;
}

const base = (p: string) => p.split('/').pop() ?? p;
const has = (facts: ProjectFacts, test: (path: string) => boolean) => facts.files.some(test);

// In order of how much they help; the first that fits is offered.
const RULES: { id: ExtensionId; reason(f: ProjectFacts): string | null }[] = [
  {
    id: 'format-lint',
    reason: (f) =>
      has(f, (p) => /^(\.eslintrc(\.\w+)?|eslint\.config\.\w+)$/.test(base(p))) || f.dependencies.includes('eslint')
        ? 'This project uses ESLint. Format & Lint shows its warnings as you type and formats with Prettier.'
        : has(f, (p) => /^(\.prettierrc(\.\w+)?|prettier\.config\.\w+)$/.test(base(p))) || f.dependencies.includes('prettier')
          ? 'This project uses Prettier. Format & Lint formats files with it, on demand or on save.'
          : has(f, (p) => /\.py$/.test(p) || /^(pyproject\.toml|\.?ruff\.toml)$/.test(base(p)))
            ? 'This project has Python. Format & Lint checks it with Ruff as you type and formats it, on demand or on save.'
            : null,
  },
  {
    id: 'intellisense',
    reason: (f) =>
      has(f, (p) => /^[jt]sconfig\.json$/.test(base(p))) || has(f, (p) => /\.(ts|tsx)$/.test(p))
        ? 'This project has TypeScript. IntelliSense adds completions, type errors and go to definition.'
        : f.files.filter((p) => /\.py$/.test(p)).length >= 2
          ? 'This project has Python. IntelliSense adds completions, hover docs and go to definition for it.'
          : null,
  },
  {
    id: 'git-pro',
    reason: (f) => (f.isGitRepo ? 'This project is a Git repository. Git Tools adds diffs, staging by hunk, branches, stash and history.' : null),
  },
  {
    id: 'debugger',
    reason: (f) => (has(f, (p) => p === '.vscode/launch.json') ? 'This project has debug settings. The Debugger adds breakpoints and stepping for Node and Python.' : null),
  },
];

export function suggestExtension(facts: ProjectFacts, installed: ExtensionId[], dismissed: ExtensionId[]): Suggestion | null {
  for (const rule of RULES) {
    if (installed.includes(rule.id) || dismissed.includes(rule.id)) continue;
    const reason = rule.reason(facts);
    if (reason) return { id: rule.id, reason };
  }
  return null;
}

export function dependenciesOf(packageJson: string | null): string[] {
  if (!packageJson) return [];
  try {
    const pkg = JSON.parse(packageJson);
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch {
    return [];
  }
}
