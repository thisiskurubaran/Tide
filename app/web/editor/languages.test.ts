import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import type { Language } from '../../src/features/editor/bridge';
import { indentFoldRange, languageExtension } from './languages';

const NEW: Language[] = ['yaml', 'toml', 'dockerfile', 'ini', 'env', 'shell', 'powershell', 'makefile', 'go', 'rust', 'java', 'c', 'cpp', 'objectivec', 'csharp', 'kotlin', 'swift', 'dart', 'xml'];

describe('languages', () => {
  it.each(NEW)('%s parses and knows its comments', (lang) => {
    const state = EditorState.create({ doc: 'a = 1\n', extensions: languageExtension(lang) });
    expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
    const tokens = state.languageDataAt<{ line?: string; block?: unknown }>('commentTokens', 1);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('highlights Makefile targets, variables and comments', () => {
    const doc = 'CC := gcc\n# note\nall: $(OBJ)\n\t$(CC) -o $@\n';
    const state = EditorState.create({ doc, extensions: languageExtension('makefile') });
    const tree = ensureSyntaxTree(state, doc.length, 1000)!;
    const names = new Set<string>();
    tree.iterate({ enter: (n) => void names.add(n.name) });
    expect([...names].join(' ')).toMatch(/comment/);
    expect([...names].join(' ')).toMatch(/variableName/);
  });

  it('folds the more indented lines after a line', () => {
    const doc = 'a:\n  b: 1\n  c:\n    d: 2\ne: 3\n';
    const state = EditorState.create({ doc });
    expect(indentFoldRange(state, 0)).toEqual({ from: 2, to: doc.indexOf('d: 2') + 4 });
    expect(indentFoldRange(state, doc.indexOf('b:'))).toBeNull();
    expect(indentFoldRange(state, doc.indexOf('e:'))).toBeNull();
  });
});
