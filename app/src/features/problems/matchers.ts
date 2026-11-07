// Problems in program output, fed one line at a time: tsc, ESLint (stylish
// and compact), pytest, Python tracebacks, Node errors and the generic
// path:line:col: error form compilers use. Paths are as printed; the caller
// maps them to project files.
import { findFileRefs } from '../terminal/fileRefs';

export type Severity = 'error' | 'warning' | 'info';

export interface OutputProblem {
  path: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  source: string;
}

const PATH = String.raw`[\w@~.+/-]*\.[A-Za-z][A-Za-z0-9]{0,9}`;
const TSC = new RegExp(String.raw`^(${PATH})(?:\((\d+),(\d+)\):|:(\d+):(\d+) -) (error|warning) (TS\d+): (.*)$`);
const GENERIC = new RegExp(String.raw`^(${PATH}):(\d+):(\d+):\s*(fatal error|error|warning|note):\s*(.*)$`);
const ESLINT_COMPACT = new RegExp(String.raw`^(${PATH}): line (\d+), col (\d+), (Error|Warning) - (.*)$`);
const ESLINT_FILE = new RegExp(String.raw`^(/?${PATH})$`);
const ESLINT_ROW = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)(?:\s{2,}(\S+))?$/;
const PYTEST = new RegExp(String.raw`^(${PATH}\.py|${PATH}):(\d+): (\w*(?:Error|Exception|Failed|Warning)\b.*)$`);
const PY_FRAME = /^\s*File "([^"]+)", line (\d+)/;
const EXCEPTION = /^(?:[\w.]+\.)?(\w*(?:Error|Exception|Warning|Interrupt|Exit))(?::\s*(.*))?$/;
const NODE_LOCATION = new RegExp(String.raw`^(/?${PATH}):(\d+)$`);

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r$/, '');
const severity = (s: string): Severity => (/warn/i.test(s) ? 'warning' : /note|info/i.test(s) ? 'info' : 'error');

export class ProblemMatcher {
  private eslintFile: string | null = null;
  private traceback: { path: string; line: number } | null = null;
  private inTraceback = false;
  private nodeLocation: { path: string; line: number } | null = null;
  private pendingError: string | null = null;

  feed(raw: string): OutputProblem[] {
    const line = strip(raw);
    let m: RegExpExecArray | null;

    if ((m = TSC.exec(line))) {
      return [{ path: m[1], line: +(m[2] ?? m[4]), column: +(m[3] ?? m[5]), severity: severity(m[6]), message: `${m[8]} (${m[7]})`, source: 'tsc' }];
    }
    if ((m = ESLINT_COMPACT.exec(line))) {
      return [{ path: m[1], line: +m[2], column: +m[3], severity: severity(m[4]), message: m[5], source: 'eslint' }];
    }
    if ((m = GENERIC.exec(line))) {
      return [{ path: m[1], line: +m[2], column: +m[3], severity: severity(m[4]), message: m[5], source: 'compiler' }];
    }
    // ESLint's default output: a file name, then indented rows, then a blank line.
    if (this.eslintFile && (m = ESLINT_ROW.exec(line))) {
      return [{ path: this.eslintFile, line: +m[1], column: +m[2], severity: severity(m[3]), message: m[5] ? `${m[4]} (${m[5]})` : m[4], source: 'eslint' }];
    }
    if (!line.trim()) this.eslintFile = null;
    else if ((m = ESLINT_FILE.exec(line.trim())) && !line.startsWith(' ')) this.eslintFile = m[1];

    if ((m = PYTEST.exec(line))) {
      return [{ path: m[1], line: +m[2], column: 1, severity: 'error', message: m[3], source: 'pytest' }];
    }

    // Python: the last frame of a traceback gets the exception that ends it.
    if (line.startsWith('Traceback (most recent call last)')) {
      this.inTraceback = true;
      this.traceback = null;
      return [];
    }
    if ((m = PY_FRAME.exec(line))) {
      this.inTraceback = true;
      this.traceback = { path: m[1], line: +m[2] };
      return [];
    }
    if (this.inTraceback && this.traceback && !line.startsWith(' ') && (m = EXCEPTION.exec(line.trim()))) {
      const at = this.traceback;
      this.inTraceback = false;
      this.traceback = null;
      return [{ path: at.path, line: at.line, column: 1, severity: 'error', message: m[2] ? `${m[1]}: ${m[2]}` : m[1], source: 'python' }];
    }

    // Node: "file.js:12" then the code and a caret, then "TypeError: …";
    // or "TypeError: …" followed by its stack, whose first frame is the place.
    if ((m = NODE_LOCATION.exec(line))) {
      this.nodeLocation = { path: m[1], line: +m[2] };
      return [];
    }
    if (!line.startsWith(' ') && (m = EXCEPTION.exec(line.trim()))) {
      const message = m[2] ? `${m[1]}: ${m[2]}` : m[1];
      if (this.nodeLocation) {
        const at = this.nodeLocation;
        this.nodeLocation = null;
        this.pendingError = null;
        return [{ path: at.path, line: at.line, column: 1, severity: 'error', message, source: 'node' }];
      }
      this.pendingError = message;
      return [];
    }
    if (this.pendingError && /^\s+at /.test(line)) {
      const [ref] = findFileRefs(line);
      if (ref && !/node_modules\//.test(ref.path)) {
        const message = this.pendingError;
        this.pendingError = null;
        return [{ path: ref.path, line: ref.line, column: ref.column ?? 1, severity: 'error', message, source: 'node' }];
      }
      return [];
    }
    if (this.pendingError && line.trim() && !/^\s+at /.test(line)) this.pendingError = null;
    return [];
  }
}

// All the problems in a block of output.
export function matchOutput(text: string): OutputProblem[] {
  const m = new ProblemMatcher();
  return text.split('\n').flatMap((l) => m.feed(l));
}
