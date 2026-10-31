import { snippet } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { snippetApplies, toCodeMirror } from './snippets';

// Expands a CodeMirror snippet into a fresh document and returns its text.
function expand(template: string): string {
  let state = EditorState.create({ doc: '' });
  snippet(template)(
    {
      state,
      dispatch: (tr: any) => {
        state = tr.state;
      },
    },
    null,
    0,
    0,
  );
  return state.doc.toString();
}

describe('snippets', () => {
  it('turns VS Code snippet syntax into CodeMirror fields', () => {
    expect(toCodeMirror('console.log($1);$0')).toBe('console.log(${1});${}');
    expect(toCodeMirror('function ${1:name}(${2:args}) {\n\t$0\n}')).toBe('function ${1:name}(${2:args}) {\n\t${}\n}');
    expect(toCodeMirror('cost: \\$10 for $1')).toBe('cost: $10 for ${1}');
    expect(expand(toCodeMirror('function ${1:name}($2) {\n  $0\n}'))).toBe('function name() {\n  \n}');
  });

  it("leaves Ruby's #{} and other text alone", () => {
    expect(expand(toCodeMirror('puts "Hi #{name}" $1'))).toBe('puts "Hi #{name}" ');
  });

  it('offers a snippet in its language family', () => {
    const js = { prefix: 'log', body: 'console.log($1)', languages: ['javascript' as const] };
    expect(snippetApplies(js, 'tsx')).toBe(true);
    expect(snippetApplies(js, 'python')).toBe(false);
    expect(snippetApplies({ prefix: 'todo', body: 'TODO: $1' }, 'python')).toBe(true);
  });
});
