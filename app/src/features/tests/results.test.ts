import { isJsTestFile, isPyTestFile, parsePythonOutput, parseTap, summarize } from './results';

// node:test output from Node 22, trimmed.
const TAP22 = `noise
TAP version 13
# Subtest: adds
ok 1 - adds
  ---
  duration_ms: 1.382055
  type: 'test'
  ...
# Subtest: fails
not ok 2 - fails
  ---
  duration_ms: 2.235582
  type: 'test'
  location: '/docs/projects/p/math.test.js:8:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:

    2 !== 3

  code: 'ERR_ASSERTION'
  stack: |-
    TestContext.<anonymous> (/docs/projects/p/math.test.js:10:10)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
  ...
# Subtest: later
ok 3 - later # SKIP
  ---
  duration_ms: 0.182662
  type: 'test'
  ...
# Subtest: group
    # Subtest: inner ok
    ok 1 - inner ok
      ---
      duration_ms: 0.187956
      ...
    # Subtest: inner bad
    not ok 2 - inner bad
      ---
      duration_ms: 0.146928
      error: 'boom'
      stack: |-
        TestContext.<anonymous> (/docs/projects/p/math.test.js:17:38)
      ...
    1..2
not ok 4 - group
  ---
  duration_ms: 0.643479
  type: 'suite'
  error: '1 subtest failed'
  ...
1..4`;

describe('test results', () => {
  it('reads node:test TAP, nesting suites and finding lines', () => {
    const results = parseTap(TAP22, 'math.test.js')!;
    expect(results.map((r) => [r.name, r.status, r.line])).toEqual([
      ['adds', 'pass', null],
      ['fails', 'fail', 8],
      ['later', 'skip', null],
      ['group › inner ok', 'pass', null],
      ['group › inner bad', 'fail', 17],
    ]);
    expect(results[1].message).toBe('Expected values to be strictly equal:\n\n2 !== 3\n\nTestContext.<anonymous> (/docs/projects/p/math.test.js:10:10)');
    expect(summarize(results)).toEqual({ pass: 2, fail: 2, skip: 1 });
  });

  it('finds a test by its name when Node gives no location', () => {
    const tap = 'TAP version 13\nok 1 - works\n  ---\n  duration_ms: 1\n  ...\n1..1';
    expect(parseTap(tap, 'a.test.js', "const test = require('node:test');\n\ntest('works', () => {});\n")![0].line).toBe(3);
    expect(parseTap('just a script\n', 'a.test.js')).toBeNull();
  });

  it('reads the Python driver output, pytest progress and all', () => {
    const mark = '\u001eTIDE-TEST ';
    const out = [
      `${mark}{"event": "result", "file": "test_a.py", "name": "TestX::test_y", "status": "fail", "ms": 0.8, "line": 6, "message": "assert 1 == 2"}`,
      `printed by a test`,
      `.F${mark}{"event": "result", "file": "test_a.py", "name": "test_ok", "status": "pass", "ms": 0.3, "line": 3, "message": null}`,
      `${mark}{"event": "done", "runner": "pytest", "code": 1}`,
    ].join('\n');
    const run = parsePythonOutput(out);
    expect(run.runner).toBe('pytest');
    expect(run.results.map((r) => [r.name, r.status, r.line])).toEqual([
      ['TestX › test_y', 'fail', 6],
      ['test_ok', 'pass', 3],
    ]);
    expect(run.output).toBe('printed by a test\n.F');
  });

  it('knows test files', () => {
    expect(['a.test.js', 'src/b.spec.mjs', 'test/c.js', '__tests__/d.cjs', 'test/fixtures/e.js', 'f.js'].filter(isJsTestFile)).toEqual([
      'a.test.js',
      'src/b.spec.mjs',
      'test/c.js',
      '__tests__/d.cjs',
    ]);
    expect(['test_a.py', 'pkg/b_test.py', 'testing.py', 'c.py'].filter(isPyTestFile)).toEqual(['test_a.py', 'pkg/b_test.py']);
  });
});
