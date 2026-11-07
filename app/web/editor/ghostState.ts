// The logic behind AI inline completions (ghost text), on plain values so it
// can be tested without CodeMirror: when to ask, which answers still apply,
// typing through a suggestion and accepting it a word at a time.

export const GHOST_DEBOUNCE_MS = 350;
export const MAX_PREFIX = 4000;
export const MAX_SUFFIX = 1000;
// Past this the editor doesn't ask; the app also turns it off for large files.
export const MAX_DOC_CHARS = 300_000;

const WORD = /[\p{L}\p{N}_$]/u;

// A suggestion on screen: `text` goes in at `pos`.
export interface Ghost {
  text: string;
  pos: number;
}

// The request in flight and what the editor looked like when it was made.
// `doc` is the document value itself (CodeMirror's Text is immutable, so an
// unchanged document is the same object).
export interface PendingRequest<Doc = unknown> {
  requestId: number;
  doc: Doc;
  head: number;
}

// Asks only at the end of a token or line, so a suggestion never has to fit
// into the middle of a word.
export function canRequest(opts: { docLength: number; empty: boolean; multi: boolean; head: number; lineEnd: number; nextChar: string }): boolean {
  if (!opts.empty || opts.multi || opts.docLength > MAX_DOC_CHARS) return false;
  return opts.head === opts.lineEnd || !WORD.test(opts.nextChar);
}

export function context(doc: string, head: number): { prefix: string; suffix: string } {
  return { prefix: doc.slice(Math.max(0, head - MAX_PREFIX), head), suffix: doc.slice(head, head + MAX_SUFFIX) };
}

// The answer is shown only if it belongs to the latest request and nothing
// has moved since: a late answer for older text would insert in the wrong place.
export function freshGhost<Doc>(
  pending: PendingRequest<Doc> | null,
  answer: { requestId: number; text: string },
  now: { doc: Doc; head: number; empty: boolean },
): Ghost | null {
  if (!pending || pending.requestId !== answer.requestId) return null;
  if (pending.doc !== now.doc || pending.head !== now.head || !now.empty) return null;
  const text = cleanSuggestion(answer.text);
  return text ? { text, pos: now.head } : null;
}

// Nothing to show for whitespace alone; trailing blank lines are noise.
export function cleanSuggestion(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return trimmed.trim() ? trimmed : '';
}

// Typing the suggestion's next characters consumes them: the rest stays,
// one past the typed text. Anything else dismisses it (null). Typing the
// whole suggestion leaves nothing to show (null too).
export function typeThrough(ghost: Ghost, typed: string, at: number): Ghost | null {
  if (at !== ghost.pos || !typed || !ghost.text.startsWith(typed)) return null;
  const text = ghost.text.slice(typed.length);
  return text ? { text, pos: ghost.pos + typed.length } : null;
}

// The next word of a suggestion: a line break with the next line's indent,
// or spaces then a run of word characters or of punctuation.
export function nextWord(text: string): string {
  const m = /^\n[ \t]*|^[ \t]*(?:[\p{L}\p{N}_$]+|[^\p{L}\p{N}_$\s]+)|^[ \t]+/u.exec(text);
  return m ? m[0] : text;
}

// Accepting all or one word: what to insert and what (if anything) stays.
export function accept(ghost: Ghost, part: 'all' | 'word'): { insert: string; rest: Ghost | null } {
  const insert = part === 'all' ? ghost.text : nextWord(ghost.text);
  const text = ghost.text.slice(insert.length);
  return { insert, rest: text ? { text, pos: ghost.pos + insert.length } : null };
}

// "claude-haiku-5-5" reads as "Haiku 5.5"; other ids lose their vendor and date.
export function shortModelName(model: string | undefined): string {
  if (!model) return 'AI';
  const id = model.slice(model.lastIndexOf('/') + 1);
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(id);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] && claude[3].length <= 2 ? `.${claude[3]}` : ''}`;
  return id.replace(/[-@:]\d{6,8}$/, '');
}
