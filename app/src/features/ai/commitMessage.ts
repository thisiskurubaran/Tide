// "Suggest message" in the commit boxes: the change as a compact unified
// diff, and a commit message for it from the chat model (the user's own key).
import { diffText } from '../../extensions/gitPro/diff';
import { chat } from './client';
import { AiError } from './providers/types';

export interface ChangedFile {
  path: string;
  // null: the file doesn't exist on that side (added or deleted).
  before: string | null;
  after: string | null;
  binary?: boolean;
}

// Enough to describe a change; big diffs are cut and say so.
export const MAX_DIFF_CHARS = 12_000;

export function formatChanges(files: ChangedFile[], maxChars = MAX_DIFF_CHARS): string {
  const parts: string[] = [];
  for (const f of files) {
    const head = f.before === null ? `new file ${f.path}` : f.after === null ? `deleted ${f.path}` : `modified ${f.path}`;
    if (f.binary) {
      parts.push(`${head} (binary)`);
      continue;
    }
    const hunks = diffText(f.before ?? '', f.after ?? '', 2);
    if (hunks === null) {
      parts.push(`${head} (too large to diff)`);
      continue;
    }
    const body = hunks
      .map((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...h.lines.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)].join('\n'))
      .join('\n');
    parts.push(`--- ${head}\n${body}`);
  }
  const all = parts.join('\n\n');
  return all.length > maxChars ? `${all.slice(0, maxChars)}\n\n[diff cut off; ${files.length} files changed in total]` : all;
}

const SYSTEM = `You write git commit messages. Reply with the message only: no preamble, no code fences, no quotes.
First line: a summary in the imperative mood ("Add", "Fix", "Rename"), at most 72 characters, no trailing period.
If the change needs more explanation, add a blank line and a short body, wrapped at 72 characters, saying what changed and why. Small changes need no body.`;

export async function suggestCommitMessage(diff: string, signal?: AbortSignal): Promise<string> {
  if (!diff.trim()) throw new AiError('There are no changes to describe.');
  const result = await chat({ job: 'chat', system: SYSTEM, messages: [{ role: 'user', content: `Write a commit message for this change:\n\n${diff}` }], maxTokens: 1000, signal });
  if (result.stop === 'refusal') throw new AiError('The model declined to write this message.', 'refusal');
  return cleanMessage(result.text);
}

// Strips fences, quotes and a "Commit message:" lead-in some answers add anyway.
export function cleanMessage(text: string): string {
  let t = text.trim().replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
  t = t.replace(/^(commit message|message)\s*:\s*/i, '').trim();
  if (/^["'`].*["'`]$/s.test(t) && !t.slice(1, -1).includes('\n')) t = t.slice(1, -1).trim();
  return t;
}
