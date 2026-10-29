import type { RunnerMessage, RunRequest } from '@shared/protocol';

import type { Runner } from '../../runtime/runner';
import { createMemoryFs } from '../files/memoryFs';
import { createWorkspace } from '../files/workspace';
import { MARK } from './pythonDriver';
import { FileRun, findTestFiles, runTests } from './runTests';

const TAP = 'TAP version 13\nok 1 - adds\n  ---\n  duration_ms: 1\n  ...\nnot ok 2 - fails\n  ---\n  duration_ms: 2\n  error: \'nope\'\n  ...\n1..2\n';

function fakeRunner(outputs: Record<string, { out: string; code: number }>) {
  const requests: RunRequest[] = [];
  const runner: Runner = {
    run(req, onMessage: (m: RunnerMessage) => void) {
      requests.push(req);
      const { out, code } = outputs[req.entry] ?? { out: '', code: 0 };
      setTimeout(() => {
        onMessage({ type: 'stdout', id: req.id, data: out });
        onMessage({ type: 'exit', id: req.id, code });
      }, 0);
    },
    send: () => undefined,
  };
  return { runner, requests };
}

async function setup() {
  const fs = createMemoryFs();
  const workspace = createWorkspace(fs);
  await workspace.createEmptyProject('p');
  await workspace.createFile('p', '', 'math.test.js', '');
  await workspace.createFile('p', '', 'check.spec.js', '');
  await workspace.createFile('p', '', 'test_a.py', '');
  await workspace.createFile('p', '', 'index.js', '');
  return { fs, workspace };
}

const collect = () => {
  const runs = new Map<string, FileRun>();
  return { runs, onUpdate: (r: FileRun) => runs.set(r.file, r) };
};

describe('runTests', () => {
  it('finds test files by language', async () => {
    const { workspace } = await setup();
    expect(await findTestFiles(workspace, 'p')).toEqual({ js: ['check.spec.js', 'math.test.js'], python: ['test_a.py'] });
  });

  it('runs each JavaScript file and reads its results', async () => {
    const { fs, workspace } = await setup();
    const { runner, requests } = fakeRunner({
      'projects/p/math.test.js': { out: TAP, code: 1 },
      'projects/p/check.spec.js': { out: 'Error: boom\n', code: 1 },
    });
    const { runs, onUpdate } = collect();
    await runTests({ runner, workspace, fs }, 'p', 'js', ['math.test.js', 'check.spec.js'], onUpdate).done;
    expect(requests.map((r) => [r.runtime, r.entry, r.cwd])).toEqual([
      ['node', 'projects/p/math.test.js', 'projects/p'],
      ['node', 'projects/p/check.spec.js', 'projects/p'],
    ]);
    expect(runs.get('math.test.js')!.results.map((r) => [r.name, r.status])).toEqual([
      ['adds', 'pass'],
      ['fails', 'fail'],
    ]);
    // Not node:test: the script's exit code decides.
    expect(runs.get('check.spec.js')!.results).toEqual([expect.objectContaining({ name: '(script)', status: 'fail', message: 'Error: boom' })]);
  });

  it('writes the Python driver and groups its results by file', async () => {
    const { fs, workspace } = await setup();
    const out = [
      `${MARK}{"event": "result", "file": "test_a.py", "name": "test_x", "status": "pass", "ms": 1, "line": 3, "message": null}`,
      `${MARK}{"event": "result", "file": "pkg/test_b.py", "name": "test_y", "status": "fail", "ms": 1, "line": 5, "message": "boom"}`,
      `${MARK}{"event": "done", "runner": "unittest", "code": 1}`,
    ].join('\n');
    const { runner, requests } = fakeRunner({ '.tide/tide_tests.py': { out, code: 0 } });
    const { runs, onUpdate } = collect();
    await runTests({ runner, workspace, fs }, 'p', 'python', [], onUpdate).done;
    expect(await fs.readFile('.tide/tide_tests.py')).toContain('def run_unittest');
    expect(requests[0]).toMatchObject({ runtime: 'python', entry: '.tide/tide_tests.py', cwd: 'projects/p', args: [] });
    expect([...runs.values()].filter((r) => r.results.length).map((r) => [r.file, r.results.length])).toEqual([
      ['test_a.py', 1],
      ['pkg/test_b.py', 1],
    ]);
  });
});
