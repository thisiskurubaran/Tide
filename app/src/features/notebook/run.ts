// Running a Jupyter notebook's Python cells on the device (Tide Pro). The
// cells run in order in one namespace, like a kernel, through a small driver
// script; each cell's output comes back as one JSON line, and is written into
// the notebook so the preview shows it.
import { toBase64 } from '../backup/zip';
import type { Notebook } from '../preview/render';

export const RESULT_PREFIX = '\u001etide-nb ';

export interface CellResult {
  cell: number;
  stdout: string;
  stderr: string;
  // repr() of the cell's last expression, as Jupyter shows it.
  result: string | null;
  error: { ename: string; evalue: string; traceback: string[] } | null;
}

const source = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join('') : (s ?? ''));

// The code cells, as [index in the notebook, source], up to and including `upTo`.
export function codeCells(nb: Notebook, upTo = Infinity): [number, string][] {
  const out: [number, string][] = [];
  nb.cells.forEach((c, i) => {
    if (c.cell_type === 'code' && i <= upTo) out.push([i, source(c.source)]);
  });
  return out;
}

// IPython-style lines (%matplotlib, !pip) can't run in plain Python; they're skipped.
const DRIVER = `
import ast, base64, contextlib, io, json, sys, traceback
__tide_cells = json.loads(base64.b64decode(__TIDE_CELLS__).decode('utf-8'))
__tide_ns = {'__name__': '__main__'}
for __tide_index, __tide_source in __tide_cells:
    __tide_src = '\\n'.join('' if l.lstrip().startswith(('%', '!')) else l for l in __tide_source.split('\\n'))
    __tide_out, __tide_err = io.StringIO(), io.StringIO()
    __tide_result, __tide_error = None, None
    try:
        with contextlib.redirect_stdout(__tide_out), contextlib.redirect_stderr(__tide_err):
            __tide_tree = ast.parse(__tide_src, filename='<cell %d>' % __tide_index)
            __tide_last = __tide_tree.body.pop() if __tide_tree.body and isinstance(__tide_tree.body[-1], ast.Expr) else None
            exec(compile(__tide_tree, '<cell %d>' % __tide_index, 'exec'), __tide_ns)
            if __tide_last is not None:
                __tide_value = eval(compile(ast.Expression(__tide_last.value), '<cell %d>' % __tide_index, 'eval'), __tide_ns)
                if __tide_value is not None:
                    __tide_result = repr(__tide_value)
    except BaseException as e:
        __tide_tb = traceback.format_exception(type(e), e, e.__traceback__)
        # Drop the driver's own frames; the cell's start at "<cell".
        __tide_keep = [l for l in __tide_tb if '__tide' not in l and 'tide-notebook' not in l]
        __tide_error = {'ename': type(e).__name__, 'evalue': str(e), 'traceback': __tide_keep}
    sys.__stdout__.write(${JSON.stringify(RESULT_PREFIX)} + json.dumps({'cell': __tide_index, 'stdout': __tide_out.getvalue(), 'stderr': __tide_err.getvalue(), 'result': __tide_result, 'error': __tide_error}) + '\\n')
    sys.__stdout__.flush()
    if __tide_error is not None:
        break
`;

export function driverScript(cells: [number, string][]): string {
  const b64 = toBase64(new TextEncoder().encode(JSON.stringify(cells)));
  return `__TIDE_CELLS__ = '${b64}'\n${DRIVER}`;
}

// Reads the driver's result lines out of everything it printed.
export function parseResults(stdout: string): CellResult[] {
  return stdout
    .split('\n')
    .filter((l) => l.startsWith(RESULT_PREFIX))
    .map((l) => JSON.parse(l.slice(RESULT_PREFIX.length)) as CellResult);
}

// The notebook with these cells' outputs and execution counts; cells that
// didn't run keep theirs. Counts start at 1 for each run, like a fresh kernel.
export function withOutputs(nb: Notebook, results: CellResult[]): Notebook {
  const byCell = new Map(results.map((r, n) => [r.cell, { r, count: n + 1 }]));
  return {
    ...nb,
    cells: nb.cells.map((c, i) => {
      const hit = byCell.get(i);
      if (!hit || c.cell_type !== 'code') return c;
      const { r, count } = hit;
      const outputs: unknown[] = [];
      if (r.stdout) outputs.push({ output_type: 'stream', name: 'stdout', text: r.stdout });
      if (r.stderr) outputs.push({ output_type: 'stream', name: 'stderr', text: r.stderr });
      if (r.result !== null) outputs.push({ output_type: 'execute_result', execution_count: count, data: { 'text/plain': r.result }, metadata: {} });
      if (r.error) outputs.push({ output_type: 'error', ...r.error });
      return { ...c, execution_count: count, outputs } as typeof c;
    }),
  };
}

export function clearOutputs(nb: Notebook): Notebook {
  return { ...nb, cells: nb.cells.map((c) => (c.cell_type === 'code' ? ({ ...c, execution_count: null, outputs: [] } as typeof c) : c)) };
}

// Jupyter writes notebooks with one-space indentation and a final newline.
export const notebookText = (nb: Notebook) => `${JSON.stringify(nb, null, 1)}\n`;
