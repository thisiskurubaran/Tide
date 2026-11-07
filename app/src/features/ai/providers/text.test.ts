import { cleanCompletion, stripThinking, thinkingFilter } from './text';
import { validateToolInput } from './tools';

describe('completion clean-up', () => {
  it('takes the code out of a fence', () => {
    expect(cleanCompletion('```js\nreturn a + b;\n```', 'function f(a, b) {\n  ', '\n}')).toBe('return a + b;');
    expect(cleanCompletion('```\nx', '', '')).toBe('x');
  });

  it('drops reasoning and the cursor marker', () => {
    expect(cleanCompletion('<think>they want a sum</think>a + b', 'return ', ';')).toBe('a + b');
    expect(cleanCompletion('a + b<CURSOR/>', 'return ', '')).toBe('a + b');
  });

  it('drops a repeated current line and code already after the cursor', () => {
    expect(cleanCompletion('  const total = items.length;', '  const total = ', '\n')).toBe('items.length;');
    expect(cleanCompletion('sum(a, b));\n}', 'console.log(', '));\n}')).toBe('sum(a, b');
  });

  it('keeps indentation and returns nothing for whitespace', () => {
    expect(cleanCompletion('    x = 1\n    y = 2', 'def f():\n', '')).toBe('    x = 1\n    y = 2');
    expect(cleanCompletion('  \n ', 'a', 'b')).toBe('');
    expect(cleanCompletion('', 'a', 'b')).toBe('');
  });
});

describe('reasoning in text', () => {
  it('strips closed and unclosed think tags', () => {
    expect(stripThinking('<think>a</think>Answer')).toBe('Answer');
    expect(stripThinking('Answer<think>still going')).toBe('Answer');
  });

  it('filters tags split across streamed pieces', () => {
    const out: string[] = [];
    const f = thinkingFilter((t) => out.push(t));
    for (const piece of ['Hi <', 'thi', 'nk>secret', ' stuff</th', 'ink> there', ' <b']) f.push(piece);
    f.flush();
    expect(out.join('')).toBe('Hi  there <b');
  });
});

describe('tool input checks', () => {
  const spec = {
    name: 'edit',
    description: '',
    inputSchema: { type: 'object' as const, properties: { path: { type: 'string' }, line: { type: 'integer' }, mode: { enum: ['a', 'b'] } }, required: ['path'], additionalProperties: false },
  };
  it('checks required fields, types, enums and extra fields', () => {
    expect(validateToolInput(spec, { path: 'a', line: 3, mode: 'a' })).toBeNull();
    expect(validateToolInput(spec, {})).toContain('"path" is missing');
    expect(validateToolInput(spec, { path: 'a', line: 1.5 })).toContain('integer');
    expect(validateToolInput(spec, { path: 'a', mode: 'c' })).toContain('one of');
    expect(validateToolInput(spec, { path: 'a', other: 1 })).toContain('not a parameter');
    expect(validateToolInput(spec, 'nope')).toContain('not an object');
  });
});
