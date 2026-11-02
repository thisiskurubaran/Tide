import { findFileRefs, projectFileFor } from './fileRefs';

const refs = (line: string) => findFileRefs(line).map((r) => ({ text: line.slice(r.start, r.end), path: r.path, line: r.line, column: r.column }));

describe('file references in terminal output', () => {
  it('finds Node, Python, tsc, eslint and pytest locations', () => {
    expect(refs('    at main (/var/mobile/Documents/projects/demo/src/app.js:12:5)')).toEqual([
      { text: '/var/mobile/Documents/projects/demo/src/app.js:12:5', path: '/var/mobile/Documents/projects/demo/src/app.js', line: 12, column: 5 },
    ]);
    expect(refs('  File "/x/projects/demo/main.py", line 3, in <module>')).toEqual([{ text: '/x/projects/demo/main.py", line 3', path: '/x/projects/demo/main.py', line: 3, column: undefined }]);
    expect(refs("src/a.ts(4,10): error TS2322: Type 'string'")).toEqual([{ text: 'src/a.ts(4,10)', path: 'src/a.ts', line: 4, column: 10 }]);
    expect(refs('tests/test_math.py:7: AssertionError')[0]).toMatchObject({ path: 'tests/test_math.py', line: 7 });
    expect(refs('./lib/util.js:3:1  error  no-unused-vars')[0]).toMatchObject({ path: './lib/util.js', line: 3, column: 1 });
  });

  it('leaves URLs, versions and internal frames alone', () => {
    expect(refs('Listening on http://localhost:3000/index.html:5')).toEqual([]);
    expect(refs('node v18.20.4 and 1.2.3:4')).toEqual([]);
    expect(refs('    at Module._compile (node:internal/modules/cjs/loader:1364:14)')).toEqual([]);
    expect(refs('    at run (node:internal/main/run.js:10:3)')).toEqual([]);
    expect(refs('Saved notes.txt')).toEqual([]);
  });

  it('maps a printed path to a project file', () => {
    const files = ['index.js', 'src/app.js', 'src/lib/util.js', 'tests/test_math.py'];
    expect(projectFileFor('/var/mobile/Documents/projects/demo/src/app.js', 'demo', files)).toBe('src/app.js');
    expect(projectFileFor('./lib/util.js', 'demo', files)).toBe('src/lib/util.js');
    expect(projectFileFor('tests/test_math.py', 'demo', files)).toBe('tests/test_math.py');
    expect(projectFileFor('/home/ci/build/other/app.js', 'demo', files)).toBe('src/app.js');
    expect(projectFileFor('missing.js', 'demo', files)).toBeNull();
  });
});
