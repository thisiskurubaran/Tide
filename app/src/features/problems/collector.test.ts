import { createDiagnosticsStore, fileDiagnostics } from '../../extensions/diagnostics';
import { createOutputCollector } from './collector';

const FILES: Record<string, string> = { 'src/a.ts': 'const a = 1;\nconst b: number = "x";\n', 'lib.py': 'def f():\n    return 1 / 0\n' };

function setup(key = 't1') {
  const store = createDiagnosticsStore();
  const c = createOutputCollector({ project: 'demo', key, files: async () => Object.keys(FILES), readText: async (p) => FILES[p] ?? null, store });
  return { store, c, problems: (path: string) => fileDiagnostics(store.getState(), 'demo', path) };
}

describe('output problems', () => {
  it('publishes problems from output, split across chunks, with offsets in the file', async () => {
    const { c, problems } = setup();
    c.write('src/a.ts(2,7): error TS2322: Type \'string\' is not assignable');
    c.write(" to type 'number'.\nTraceback (most recent call last):\n  File \"/var/x/projects/demo/lib.py\", line 2, in f\nZeroDivisionError: division by zero\n");
    await c.flush();
    expect(problems('src/a.ts')).toEqual([
      expect.objectContaining({ line: 2, column: 7, from: 19, to: 35, severity: 'error', source: 'tsc' }),
    ]);
    expect(problems('lib.py')[0]).toMatchObject({ line: 2, message: 'ZeroDivisionError: division by zero', source: 'python' });
  });

  it('clears its problems on a new command, and leaves other terminals alone', async () => {
    const a = setup('t1');
    const b = createOutputCollector({ project: 'demo', key: 't2', files: async () => Object.keys(FILES), readText: async (p) => FILES[p] ?? null, store: a.store });
    a.c.write('src/a.ts(1,1): error TS1: one\n');
    b.write('src/a.ts(2,1): error TS2: two\n');
    await Promise.all([a.c.flush(), b.flush()]);
    expect(a.problems('src/a.ts')).toHaveLength(2);
    a.c.reset();
    expect(a.problems('src/a.ts').map((d) => d.message)).toEqual(['two (TS2)']);
  });

  it('skips files outside the project and repeated lines', async () => {
    const { c, problems, store } = setup();
    c.write('/usr/lib/other.ts(1,1): error TS1: elsewhere\nsrc/a.ts(1,1): error TS1: dup\nsrc/a.ts(1,1): error TS1: dup\n');
    await c.flush();
    expect(problems('src/a.ts')).toHaveLength(1);
    expect(Object.keys(store.getState().byProject.demo)).toEqual(['src/a.ts']);
  });
});
