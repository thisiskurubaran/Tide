import { findTodos, todosIn } from './todos';

describe('TODO notes', () => {
  it('finds tags in the comment styles of each language', () => {
    const js = `// TODO: handle errors
const a = 1; // FIXME(ada) off by one
/* HACK - works around a Safari bug */
 * XXX remove before release
const todo = "TODO: not a comment";
// todo lowercase is ignored`;
    expect(todosIn('a.js', js)).toEqual([
      { path: 'a.js', line: 1, tag: 'TODO', text: 'handle errors' },
      { path: 'a.js', line: 2, tag: 'FIXME', text: 'off by one' },
      { path: 'a.js', line: 3, tag: 'HACK', text: 'works around a Safari bug' },
      { path: 'a.js', line: 4, tag: 'XXX', text: 'remove before release' },
    ]);
    expect(todosIn('a.py', 'x = 1  # TODO add tests\n')).toEqual([{ path: 'a.py', line: 1, tag: 'TODO', text: 'add tests' }]);
    expect(todosIn('a.lua', '-- BUG: crashes on nil')[0]).toMatchObject({ tag: 'BUG', text: 'crashes on nil' });
    expect(todosIn('a.html', '<!-- TODO: footer -->')[0]).toMatchObject({ text: 'footer' });
  });

  it('scans the project, skipping generated and binary files', async () => {
    const files: Record<string, string> = {
      'src/a.ts': '// TODO one\n',
      'dist/out.js': '// TODO not mine\n',
      'app.min.js': '// TODO minified\n',
      'img.png': '\u0000// TODO',
      'b.rb': "# FIXME: two\n",
    };
    const result = await findTodos({ listFiles: async () => Object.keys(files), readFile: async (_p, path) => files[path] }, 'p');
    expect(result.todos.map((t) => `${t.path}:${t.tag}`)).toEqual(['b.rb:FIXME', 'src/a.ts:TODO']);
    expect(result.truncated).toBe(false);
  });
});
