export interface Parsed {
  args: string[];
  redirect?: { append: boolean; path: string };
}

export class ParseError extends Error {}

// Splits a command line the way a POSIX shell would for the cases we support:
// single and double quotes, backslash escapes, and a trailing > or >> redirect.
export function tokenize(line: string): Parsed {
  const words: { text: string; quoted: boolean }[] = [];
  let current = '';
  let quoted = false;
  let inWord = false;
  let quote: '"' | "'" | null = null;

  const push = () => {
    if (inWord) words.push({ text: current, quoted });
    current = '';
    quoted = false;
    inWord = false;
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) current += line[++i];
      else current += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      quoted = true;
      inWord = true;
    } else if (c === '\\' && i + 1 < line.length) {
      current += line[++i];
      inWord = true;
    } else if (c === ' ' || c === '\t') {
      push();
    } else if (c === '>') {
      push();
      const append = line[i + 1] === '>';
      if (append) i++;
      words.push({ text: append ? '>>' : '>', quoted: false });
    } else {
      current += c;
      inWord = true;
    }
  }
  if (quote) throw new ParseError(`unterminated ${quote === '"' ? 'double' : 'single'} quote`);
  push();

  const op = words.findIndex((w) => !w.quoted && (w.text === '>' || w.text === '>>'));
  if (op === -1) return { args: words.map((w) => w.text) };
  const target = words[op + 1];
  if (!target || (!target.quoted && (target.text === '>' || target.text === '>>'))) {
    throw new ParseError('missing file name after redirect');
  }
  if (op + 2 < words.length) throw new ParseError('only one redirect at the end of a command is supported');
  return {
    args: words.slice(0, op).map((w) => w.text),
    redirect: { append: words[op].text === '>>', path: target.text },
  };
}

// The reverse of tokenize for one word: backslashes before anything tokenize
// would otherwise split on or treat specially, so "My App" stays one argument.
export const escapeWord = (word: string) => word.replace(/[\s'"\\>]/g, '\\$&');

// The word the cursor is in, for Tab completion: where it starts, its text
// with escapes and quotes removed, and the quote it is still inside, if any.
export function currentWord(before: string) {
  let start = 0;
  let quote: '"' | "'" | null = null;
  let text = '';
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (quote) {
      if (c === quote) quote = null;
      else text += c;
    } else if (c === '\\' && i + 1 < before.length) {
      text += before[++i];
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ' ' || c === '\t') {
      start = i + 1;
      text = '';
    } else {
      text += c;
    }
  }
  return { start, text, quote };
}
