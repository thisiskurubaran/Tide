import { commentTarget, parsePatch } from './diff';

it('numbers patch lines for line comments', () => {
  const lines = parsePatch('@@ -10,3 +10,4 @@ function a() {\n const x = 1;\n-const y = 2;\n+const y = 3;\n+const z = 4;\n return x;\n\\ No newline at end of file');
  expect(lines.map((l) => [l.kind, l.old, l.new])).toEqual([
    ['hunk', null, null],
    ['ctx', 10, 10],
    ['del', 11, null],
    ['add', null, 11],
    ['add', null, 12],
    ['ctx', 12, 13],
  ]);
  expect(commentTarget(lines[2])).toEqual({ line: 11, side: 'LEFT' });
  expect(commentTarget(lines[4])).toEqual({ line: 12, side: 'RIGHT' });
  expect(commentTarget(lines[0])).toBeNull();
});
