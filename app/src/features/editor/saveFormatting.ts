// Applies trim trailing whitespace and insert final newline when a buffer is
// saved (buffers.ts calls the formatter set with setSaveFormatter).
//
// How it stays out of the way of typing:
// - Explicit saves (⌘S, Save in the palette, closing a tab, Run and other
//   flushes) format the whole file.
// - Autosave runs only after typing pauses (AUTOSAVE_MS), and leaves the line
//   with the cursor alone, so a space typed before the pause is still there
//   when typing goes on; it is trimmed by the next explicit save, or by an
//   autosave once the cursor is on another line.
// - The formatted text goes back into the buffer only if nothing was typed
//   while the file was being written, and from there into the editor as an
//   edit (setContent, one change per line), so undo history survives and the
//   cursor stays where it was (at most pulled back to the trimmed line end).
//   Typing the editor still held back wins: the edit is skipped and the next
//   save formats again.
import { languageFor } from './bridge';
import { FileFormatting, loadFileFormatting } from './editorconfig';
import { formatOnSave, lineAt, saveRules } from './saveFormat';
import { selectionStore } from './selection';

export type SaveReason = 'explicit' | 'auto' | 'flush';
export type SaveFormatter = (project: string, path: string, content: string, reason: SaveReason) => Promise<string>;

export type ReadFile = (project: string, path: string) => Promise<string | null>;

const EDITORCONFIG = '.editorconfig';
const isEditorConfig = (path: string) => path === EDITORCONFIG || path.endsWith(`/${EDITORCONFIG}`);

// Resolved .editorconfig settings per file, read again whenever the file opens.
const cache = new Map<string, Promise<FileFormatting>>();
const cacheKey = (project: string, path: string) => `${project}\u0000${path}`;

export function fileFormatting(read: ReadFile, project: string, path: string, fresh = false): Promise<FileFormatting> {
  const key = cacheKey(project, path);
  let entry = fresh ? undefined : cache.get(key);
  if (!entry) {
    entry = loadFileFormatting((p) => read(project, p), path).catch(() => ({}));
    cache.set(key, entry);
  }
  return entry;
}

// After an .editorconfig changes, every file of the project resolves again.
export function forgetFormatting(project: string) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${project}\u0000`)) cache.delete(key);
}

export interface SaveSettings {
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
}

export function createSaveFormatter(read: ReadFile, settings: () => SaveSettings): SaveFormatter {
  return async (project, path, content, reason) => {
    if (isEditorConfig(path)) forgetFormatting(project);
    const rules = saveRules(settings(), await fileFormatting(read, project, path), languageFor(path) === 'markdown');
    if (!rules.trimTrailingWhitespace && !rules.insertFinalNewline) return content;
    let keep: number | null = null;
    if (reason === 'auto') {
      const sel = selectionStore.getState();
      if (sel.project === project && sel.path === path) keep = lineAt(content, sel.head);
    }
    return formatOnSave(content, rules, keep);
  };
}
