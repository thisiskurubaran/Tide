export class PathError extends Error {}

// Resolves a path typed in the shell against the current directory. "/" and
// "~" mean the project root, and ".." can't climb above it.
// Returns a project-relative path with no leading slash ("" is the root).
export function resolvePath(cwd: string, input: string): string {
  let rest = input;
  let base = cwd ? cwd.split('/') : [];
  if (rest === '~' || rest.startsWith('~/')) {
    base = [];
    rest = rest.slice(1);
  }
  if (rest.startsWith('/')) base = [];
  const parts = [...base];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new PathError(`${input}: outside the project`);
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

export const displayPath = (path: string) => `/${path}`;
