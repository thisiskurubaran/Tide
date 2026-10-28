export const WORKSPACE = '/workspace';

// Project-relative path from the app; rejects anything that leaves the workspace.
export function safePath(input: unknown): string {
  if (typeof input !== 'string' || !input) throw new Error('missing path');
  const parts: string[] = [];
  for (const part of input.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' || part.includes('\0')) throw new Error(`bad path: ${input}`);
    parts.push(part);
  }
  if (!parts.length) throw new Error(`bad path: ${input}`);
  return parts.join('/');
}
