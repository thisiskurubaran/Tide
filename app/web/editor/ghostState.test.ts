import { accept, canRequest, cleanSuggestion, context, freshGhost, MAX_DOC_CHARS, MAX_PREFIX, MAX_SUFFIX, nextWord, shortModelName, typeThrough } from './ghostState';

describe('when to ask', () => {
  const at = (over: Partial<Parameters<typeof canRequest>[0]> = {}) =>
    canRequest({ docLength: 100, empty: true, multi: false, head: 10, lineEnd: 10, nextChar: '\n', ...over });

  it('asks at the end of a line or a token', () => {
    expect(at()).toBe(true);
    expect(at({ lineEnd: 20, nextChar: ')' })).toBe(true);
    expect(at({ lineEnd: 20, nextChar: ' ' })).toBe(true);
  });

  it("doesn't ask inside a word, with a selection, several cursors or a huge file", () => {
    expect(at({ lineEnd: 20, nextChar: 'x' })).toBe(false);
    expect(at({ lineEnd: 20, nextChar: '_' })).toBe(false);
    expect(at({ empty: false })).toBe(false);
    expect(at({ multi: true })).toBe(false);
    expect(at({ docLength: MAX_DOC_CHARS + 1 })).toBe(false);
  });

  it('caps the text sent around the cursor', () => {
    const doc = 'a'.repeat(5000) + 'b'.repeat(2000);
    const { prefix, suffix } = context(doc, 5000);
    expect(prefix).toBe('a'.repeat(MAX_PREFIX));
    expect(suffix).toBe('b'.repeat(MAX_SUFFIX));
    expect(context('ab', 1)).toEqual({ prefix: 'a', suffix: 'b' });
  });
});

describe('answers', () => {
  const doc = { v: 1 };
  const pending = { requestId: 3, doc, head: 5 };

  it('shows an answer for the latest request when nothing moved', () => {
    expect(freshGhost(pending, { requestId: 3, text: 'foo()' }, { doc, head: 5, empty: true })).toEqual({ text: 'foo()', pos: 5 });
  });

  it('drops stale answers', () => {
    expect(freshGhost(pending, { requestId: 2, text: 'old' }, { doc, head: 5, empty: true })).toBeNull();
    expect(freshGhost(pending, { requestId: 3, text: 'x' }, { doc: { v: 2 }, head: 5, empty: true })).toBeNull();
    expect(freshGhost(pending, { requestId: 3, text: 'x' }, { doc, head: 6, empty: true })).toBeNull();
    expect(freshGhost(pending, { requestId: 3, text: 'x' }, { doc, head: 5, empty: false })).toBeNull();
    expect(freshGhost(null, { requestId: 3, text: 'x' }, { doc, head: 5, empty: true })).toBeNull();
  });

  it('shows nothing for empty or blank answers', () => {
    expect(freshGhost(pending, { requestId: 3, text: '' }, { doc, head: 5, empty: true })).toBeNull();
    expect(freshGhost(pending, { requestId: 3, text: ' \n\t' }, { doc, head: 5, empty: true })).toBeNull();
    expect(cleanSuggestion('a\r\n  b\n\n')).toBe('a\n  b');
  });
});

describe('typing through', () => {
  const ghost = { text: 'log(x)', pos: 10 };

  it('consumes matching characters', () => {
    expect(typeThrough(ghost, 'l', 10)).toEqual({ text: 'og(x)', pos: 11 });
    expect(typeThrough(ghost, 'log(', 10)).toEqual({ text: 'x)', pos: 14 });
  });

  it('dismisses on anything else, and when the whole suggestion is typed', () => {
    expect(typeThrough(ghost, 'x', 10)).toBeNull();
    expect(typeThrough(ghost, 'l', 9)).toBeNull();
    expect(typeThrough(ghost, 'log(x)', 10)).toBeNull();
  });
});

describe('accepting', () => {
  it.each([
    ['foo.bar', 'foo'],
    ['.bar()', '.'],
    ['  value = 1', '  value'],
    ['(a, b)', '('],
    [' => {', ' =>'],
    ['\n  return x;', '\n  '],
    ['   ', '   '],
    ['héllo wörld', 'héllo'],
  ])('one word of %j is %j', (text, word) => {
    expect(nextWord(text)).toBe(word);
  });

  it('accepts all or word by word, keeping the rest after the inserted text', () => {
    const ghost = { text: 'items.map(fn)', pos: 4 };
    expect(accept(ghost, 'all')).toEqual({ insert: 'items.map(fn)', rest: null });
    const first = accept(ghost, 'word');
    expect(first).toEqual({ insert: 'items', rest: { text: '.map(fn)', pos: 9 } });
    expect(accept(first.rest!, 'word')).toEqual({ insert: '.', rest: { text: 'map(fn)', pos: 10 } });
    expect(accept({ text: 'x', pos: 0 }, 'word')).toEqual({ insert: 'x', rest: null });
  });
});

it('shortens model ids for the hint', () => {
  expect(shortModelName('claude-haiku-5-5')).toBe('Haiku 5.5');
  expect(shortModelName('claude-sonnet-4-20250514')).toBe('Sonnet 4');
  expect(shortModelName('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
  expect(shortModelName(undefined)).toBe('AI');
});
