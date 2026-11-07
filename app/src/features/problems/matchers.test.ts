import { matchOutput } from './matchers';

const short = (text: string) => matchOutput(text).map((p) => `${p.source} ${p.severity} ${p.path}:${p.line}:${p.column} ${p.message}`);

describe('problem matchers', () => {
  it('reads tsc in both formats', () => {
    expect(short("src/a.ts(4,10): error TS2322: Type 'string' is not assignable to type 'number'.")).toEqual([
      "tsc error src/a.ts:4:10 Type 'string' is not assignable to type 'number'. (TS2322)",
    ]);
    expect(short('\x1b[96msrc/b.ts\x1b[0m:\x1b[93m2\x1b[0m:\x1b[93m7\x1b[0m - \x1b[91merror\x1b[0m\x1b[90m TS2304: \x1b[0mCannot find name \'x\'.')).toEqual([
      "tsc error src/b.ts:2:7 Cannot find name 'x'. (TS2304)",
    ]);
  });

  it('reads ESLint stylish and compact output', () => {
    const stylish = ['/home/me/projects/demo/src/app.js', '  3:7   error    \'x\' is assigned a value but never used  no-unused-vars', '  9:1   warning  Unexpected console statement           no-console', '', '✖ 2 problems'].join('\n');
    expect(short(stylish)).toEqual([
      "eslint error /home/me/projects/demo/src/app.js:3:7 'x' is assigned a value but never used (no-unused-vars)",
      'eslint warning /home/me/projects/demo/src/app.js:9:1 Unexpected console statement (no-console)',
    ]);
    expect(short('src/a.js: line 2, col 5, Error - Missing semicolon. (semi)')).toEqual(['eslint error src/a.js:2:5 Missing semicolon. (semi)']);
  });

  it('reads pytest failures and Python tracebacks', () => {
    expect(short('tests/test_math.py:7: AssertionError')).toEqual(['pytest error tests/test_math.py:7:1 AssertionError']);
    const tb = ['Traceback (most recent call last):', '  File "/x/projects/demo/main.py", line 9, in <module>', '    run()', '  File "/x/projects/demo/lib.py", line 3, in run', '    return 1 / 0', 'ZeroDivisionError: division by zero'].join('\n');
    expect(short(tb)).toEqual(['python error /x/projects/demo/lib.py:3:1 ZeroDivisionError: division by zero']);
    const syntax = ['  File "/x/projects/demo/bad.py", line 2', '    def f(:', '          ^', 'SyntaxError: invalid syntax'].join('\n');
    expect(short(syntax)).toEqual(['python error /x/projects/demo/bad.py:2:1 SyntaxError: invalid syntax']);
  });

  it('reads Node errors, both uncaught and with a stack', () => {
    const uncaught = ['/x/projects/demo/index.js:12', '  foo();', '  ^', '', 'ReferenceError: foo is not defined', '    at Object.<anonymous> (/x/projects/demo/index.js:12:3)'].join('\n');
    expect(short(uncaught)).toEqual(['node error /x/projects/demo/index.js:12:1 ReferenceError: foo is not defined']);
    const stack = ['TypeError: x.map is not a function', '    at render (/x/projects/demo/node_modules/lib/a.js:1:1)', '    at main (/x/projects/demo/src/app.js:20:9)'].join('\n');
    expect(short(stack)).toEqual(['node error /x/projects/demo/src/app.js:20:9 TypeError: x.map is not a function']);
  });

  it('reads compiler-style errors and ignores ordinary output', () => {
    expect(short('main.c:3:5: error: expected \';\' before \'}\' token')).toEqual(["compiler error main.c:3:5 expected ';' before '}' token"]);
    expect(short('Listening on http://localhost:3000\nSaved notes.txt\n3 passed in 0.12s')).toEqual([]);
  });
});
