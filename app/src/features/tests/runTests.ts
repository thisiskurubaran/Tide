import type { Runner } from '../../runtime/runner';
import type { FsAdapter } from '../files/fs';
import { joinPath } from '../files/fs';
import type { Workspace } from '../files/workspace';
import { PROJECTS_DIR } from '../files/workspace';
import { PYTHON_DRIVER } from './pythonDriver';
import { isJsTestFile, isPyTestFile, parsePythonOutput, parseTap, TestResult } from './results';

export type TestLanguage = 'js' | 'python';

export interface FileRun {
  file: string;
  results: TestResult[];
  // What the tests printed, besides results.
  output: string;
  done: boolean;
}

const DRIVER_PATH = '.tide/tide_tests.py';
let next = 0;

export async function findTestFiles(workspace: Workspace, project: string): Promise<Record<TestLanguage, string[]>> {
  const files = await workspace.listFiles(project);
  return { js: files.filter(isJsTestFile).sort(), python: files.filter(isPyTestFile).sort() };
}

interface Session {
  // Resolves once every file has run, or after stop().
  done: Promise<void>;
  stop(): void;
}

// Runs the given test files (or, for Python, discovery when none are given),
// reporting each file as it starts and finishes.
export function runTests(
  { runner, workspace, fs }: { runner: Runner; workspace: Workspace; fs: FsAdapter },
  project: string,
  language: TestLanguage,
  files: string[],
  onUpdate: (run: FileRun) => void,
): Session {
  let stopped = false;
  let current: string | null = null;
  const cwd = joinPath(PROJECTS_DIR, project);

  const exec = (runtime: 'node' | 'python', entry: string, args: string[]) =>
    new Promise<{ code: number; output: string }>((resolve) => {
      const id = `tests-${++next}`;
      current = id;
      let output = '';
      runner.run({ type: 'run', id, runtime, entry, cwd, args }, (msg) => {
        if (msg.type === 'stdout' || msg.type === 'stderr') output += msg.data;
        else if (msg.type === 'exit') resolve({ code: msg.code ?? 1, output });
      });
    });

  async function js() {
    for (const file of files) {
      if (stopped) return;
      onUpdate({ file, results: [], output: '', done: false });
      const { code, output } = await exec('node', joinPath(cwd, file), []);
      const source = await workspace.readFile(project, file).catch(() => null);
      const results = parseTap(output, file, source) ?? [
        // Not node:test: a plain script that passes by exiting cleanly.
        { file, name: '(script)', status: code === 0 ? 'pass' : 'fail', ms: null, line: null, message: code === 0 ? null : output.trim().split('\n').slice(-20).join('\n') },
      ];
      const printed = output.split('\nTAP version')[0].trim();
      onUpdate({ file, results, output: parseTap(output, file) ? printed : output.trim(), done: true });
    }
  }

  async function python() {
    await fs.writeFile(DRIVER_PATH, PYTHON_DRIVER);
    const label = files.length === 1 ? files[0] : 'Python tests';
    onUpdate({ file: label, results: [], output: '', done: false });
    const { code, output } = await exec('python', DRIVER_PATH, files);
    const run = parsePythonOutput(output);
    const results = [...run.results];
    if (run.crash) results.push({ file: null, name: '(test runner)', status: 'fail', ms: null, line: null, message: run.crash });
    else if (!run.runner && code !== 0) results.push({ file: null, name: '(test runner)', status: 'fail', ms: null, line: null, message: output.trim().split('\n').slice(-20).join('\n') });
    // One entry per file, like JavaScript.
    const byFile = new Map<string, TestResult[]>();
    for (const r of results) byFile.set(r.file ?? label, [...(byFile.get(r.file ?? label) ?? []), r]);
    if (!byFile.size) onUpdate({ file: label, results: [], output: run.output || 'No tests found.', done: true });
    else {
      let first = true;
      for (const [file, list] of byFile) {
        onUpdate({ file, results: list, output: first ? run.output : '', done: true });
        first = false;
      }
      if (!byFile.has(label)) onUpdate({ file: label, results: [], output: '', done: true });
    }
  }

  return {
    done: (language === 'js' ? js() : python()).catch((e: Error) =>
      onUpdate({ file: '(test runner)', results: [{ file: null, name: '(test runner)', status: 'fail', ms: null, line: null, message: e.message }], output: '', done: true }),
    ),
    stop() {
      stopped = true;
      if (current) runner.send({ type: 'kill', id: current });
    },
  };
}
