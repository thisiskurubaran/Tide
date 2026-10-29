// Turning test runner output into results: node:test's TAP for JavaScript,
// and the Python driver's marked JSON lines.
import { MARK } from './pythonDriver';

export type Status = 'pass' | 'fail' | 'skip';

export interface TestResult {
  file: string | null;
  // Suites and test joined with " › ".
  name: string;
  status: Status;
  ms: number | null;
  // 1-based, in `file`.
  line: number | null;
  message: string | null;
}

interface TapEntry {
  indent: number;
  ok: boolean;
  name: string;
  skip: boolean;
  yaml: Record<string, string>;
}

// The YAML blocks node:test prints are simple: `key: value` and `key: |-`
// followed by more-indented lines.
function parseYaml(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)([\w-]+): ?(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, indent, key, value] = m;
    if (value === '|-' || value === '|' || value === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].length - lines[i + 1].trimStart().length > indent.length)) {
        block.push(lines[++i].slice(indent.length + 2));
      }
      out[key] = block.join('\n').replace(/\s+$/, '');
    } else out[key] = value.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  }
  return out;
}

export function parseTap(output: string, file: string, fileText: string | null = null): TestResult[] | null {
  const lines = output.split('\n');
  if (!lines.some((l) => l.startsWith('TAP version'))) return null;
  const entries: TapEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    const yaml: string[] = [];
    if (lines[i + 1]?.trim() === '---') {
      i += 2;
      while (i < lines.length && lines[i].trim() !== '...') yaml.push(lines[i++]);
    }
    entries.push({ indent, ok: m[2] === 'ok', name: m[3].replace(/\\#/g, '#'), skip: m[4] === 'SKIP', yaml: parseYaml(yaml) });
  }
  // Subtests are printed before their parent; walking backwards meets the
  // parent first, so a stack of open suites names each test's path.
  const out: TestResult[] = [];
  const stack: { indent: number; name: string }[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    while (stack.length && stack[stack.length - 1].indent >= e.indent) stack.pop();
    const isSuite = e.yaml.type === 'suite' || (i > 0 && entries[i - 1].indent > e.indent);
    if (isSuite) {
      stack.push({ indent: e.indent, name: e.name });
      continue;
    }
    out.push({
      file,
      name: [...stack.map((s) => s.name), e.name].join(' › '),
      status: e.skip ? 'skip' : e.ok ? 'pass' : 'fail',
      ms: e.yaml.duration_ms ? Math.round(Number(e.yaml.duration_ms) * 10) / 10 : null,
      line: lineOf(e, file, fileText),
      message: e.ok ? null : [e.yaml.error, e.yaml.stack && userFrames(e.yaml.stack)].filter(Boolean).join('\n\n') || null,
    });
  }
  return out.reverse();
}

// Where the test is: node:test's location (Node 20+), else the first stack
// frame in the file, else where the test's name appears in the source.
function lineOf(e: TapEntry, file: string, fileText: string | null): number | null {
  const fromLocation = /:(\d+):\d+$/.exec(e.yaml.location ?? '');
  if (fromLocation) return Number(fromLocation[1]);
  const base = file.split('/').pop()!;
  const frame = new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):\\d+`).exec(e.yaml.stack ?? '');
  if (frame) return Number(frame[1]);
  if (fileText) {
    const i = fileText.split('\n').findIndex((l) => l.includes(`'${e.name}'`) || l.includes(`"${e.name}"`) || l.includes(`\`${e.name}\``));
    if (i >= 0) return i + 1;
  }
  return null;
}

// Node's own frames say nothing about the user's code.
const userFrames = (stack: string) =>
  stack
    .split('\n')
    .filter((l) => !/\(node:|^\s*(async )?node:|node:internal/.test(l))
    .join('\n');

export interface PythonRun {
  results: TestResult[];
  runner: 'pytest' | 'unittest' | null;
  crash: string | null;
  // Everything else the tests printed.
  output: string;
}

export function parsePythonOutput(output: string): PythonRun {
  const run: PythonRun = { results: [], runner: null, crash: null, output: '' };
  const rest: string[] = [];
  for (const line of output.split('\n')) {
    const at = line.indexOf(MARK);
    if (at === -1) {
      rest.push(line);
      continue;
    }
    // pytest's progress dots share the line.
    if (at > 0) rest.push(line.slice(0, at));
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line.slice(at + MARK.length));
    } catch {
      continue;
    }
    if (event.event === 'result') {
      run.results.push({
        file: (event.file as string) ?? null,
        name: String(event.name).replace(/::/g, ' › '),
        status: event.status as Status,
        ms: typeof event.ms === 'number' ? event.ms : null,
        line: typeof event.line === 'number' ? event.line : null,
        message: (event.message as string) ?? null,
      });
    } else if (event.event === 'done') run.runner = event.runner as PythonRun['runner'];
    else if (event.event === 'crash') run.crash = String(event.message);
  }
  run.output = rest.join('\n').trim();
  return run;
}

export function summarize(results: TestResult[]) {
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
  };
}

// Test files the runner looks for when nothing narrower is asked for.
export const isJsTestFile = (path: string) =>
  /\.(test|spec)\.(c|m)?js$/.test(path) || (/(^|\/)(test|tests|__tests__)\//.test(path) && /\.(c|m)?js$/.test(path) && !/(^|\/)(fixtures?|helpers?)\//.test(path));

export const isPyTestFile = (path: string) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(path);
