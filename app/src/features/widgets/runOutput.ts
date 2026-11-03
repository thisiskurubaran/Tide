// What the run Live Activity shows for a dev server, test run or task, read
// from its output, and when it starts, changes or ends. Pure apart from the
// injected native calls and timers, so it's testable without the module.
import type { RunKind, RunStatus } from '../../../modules/tide-widgets/src';

export type { RunKind, RunStatus };

export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface RunState {
  kind: RunKind;
  command: string;
  // Shown until the output says something better.
  initial: string;
  // A dev server's address, without the scheme: "localhost:5173".
  url?: string;
  errors: number;
  tests?: TestCounts;
  // Jest prints a line per test file before its summary.
  files?: { done: number; failed: number };
  // pytest says how many tests it collected, then prints its progress in %.
  collected?: number;
  pytestPercent?: number;
  pytestFailed?: number;
  lastLine?: string;
}

export interface RunView {
  detail: string;
  progress: number | null;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

const count = (text: string, word: RegExp) => {
  const m = text.match(new RegExp(`(\\d+)\\s+${word.source}`, 'i'));
  return m ? Number(m[1]) : 0;
};

// A test runner's summary line: jest/vitest/pytest/node --test. Null for
// anything else.
export function testSummary(line: string): TestCounts | null {
  // jest: "Tests:       3 failed, 1 skipped, 38 passed, 52 total"
  let m = line.match(/^\s*Tests:\s+(.*\d+\s+total)/);
  if (m) {
    return { passed: count(m[1], /passed/), failed: count(m[1], /failed/), skipped: count(m[1], /skipped/) + count(m[1], /todo/), total: count(m[1], /total/) };
  }
  // vitest: "      Tests  3 failed | 38 passed | 1 skipped (42)"
  m = line.match(/^\s*Tests\s+(.*?)\s*\((\d+)\)/);
  if (m && /\d+\s+(passed|failed|skipped|todo)/.test(m[1])) {
    return { passed: count(m[1], /passed/), failed: count(m[1], /failed/), skipped: count(m[1], /skipped/) + count(m[1], /todo/), total: Number(m[2]) };
  }
  // pytest: "==== 3 failed, 38 passed, 2 skipped in 0.12s ====" (also "no tests ran")
  m = line.match(/^=+\s+(.*\d+\s+(?:passed|failed|errors?|skipped)\b.*?)\s+in\s+[\d.]+s\b.*=+\s*$/);
  if (m) {
    const passed = count(m[1], /passed/) + count(m[1], /xpassed/);
    const failed = count(m[1], /failed/) + count(m[1], /errors?/);
    const skipped = count(m[1], /skipped/) + count(m[1], /xfailed/);
    return { passed, failed, skipped, total: passed + failed + skipped };
  }
  return null;
}

// node --test prints its summary over several lines: "# tests 52", "# pass 49"...
function nodeTestLine(line: string, tests: TestCounts | undefined): TestCounts | null {
  const m = line.match(/^#\s+(tests|pass|fail|skipped|todo)\s+(\d+)\s*$/);
  if (!m) return null;
  const t = { ...(tests ?? { passed: 0, failed: 0, skipped: 0, total: 0 }) };
  const n = Number(m[2]);
  if (m[1] === 'tests') t.total = n;
  else if (m[1] === 'pass') t.passed = n;
  else if (m[1] === 'fail') t.failed = n;
  else t.skipped += n;
  return t;
}

// The first local address a dev server prints, e.g. "localhost:5173".
export function localAddress(line: string): string | null {
  const m = line.match(/\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|(?:\d{1,3}\.){3}\d{1,3})(:\d+)?/i);
  if (!m) return null;
  const host = m[1] === '0.0.0.0' || m[1] === '127.0.0.1' || m[1].startsWith('[') ? 'localhost' : m[1].toLowerCase();
  return `${host}${m[2] ?? ''}`;
}

export function initialState(kind: RunKind, command: string, detail?: string): RunState {
  return { kind, command, initial: detail || (kind === 'server' ? 'Starting…' : kind === 'tests' ? 'Running tests…' : command), errors: 0 };
}

export function readLine(state: RunState, raw: string): RunState {
  const line = stripAnsi(raw).replace(/\r/g, '').trimEnd();
  if (!line.trim()) return state;
  const s = { ...state, lastLine: line.trim().slice(0, 80) };
  if (s.kind === 'server') {
    if (!s.url) {
      const url = localAddress(line);
      if (url) s.url = url;
    }
    const found = line.match(/Found (\d+) errors?/i);
    if (found) s.errors = Number(found[1]);
    else if (/hmr update|page reload|compiled successfully|ready in|no errors/i.test(line)) s.errors = 0;
    else if (/\berror\b/i.test(line) && !/\b0 errors?\b/i.test(line)) s.errors += 1;
    return s;
  }
  if (s.kind === 'tests') {
    const summary = testSummary(line) ?? nodeTestLine(line, s.tests);
    if (summary) return { ...s, tests: summary };
    const file = line.match(/^\s*(PASS|FAIL)\s+\S/);
    if (file) {
      const f = s.files ?? { done: 0, failed: 0 };
      return { ...s, files: { done: f.done + 1, failed: f.failed + (file[1] === 'FAIL' ? 1 : 0) } };
    }
    const collected = line.match(/^collected (\d+) items?/);
    if (collected) return { ...s, collected: Number(collected[1]), pytestFailed: 0 };
    // "tests/test_a.py ..F.s                [ 40%]"
    const progress = s.collected != null ? line.match(/^\S+\.py\s+([.FEsxX]+)\s+\[\s*(\d+)%\]/) : null;
    if (progress) {
      const failed = (s.pytestFailed ?? 0) + (progress[1].match(/[FE]/g)?.length ?? 0);
      return { ...s, pytestFailed: failed, pytestPercent: Number(progress[2]) };
    }
  }
  return s;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The detail line and progress bar while it runs.
export function view(state: RunState): RunView {
  if (state.kind === 'server') {
    return { detail: state.url ? `${state.url} · ${plural(state.errors, 'error')}` : state.initial, progress: null };
  }
  if (state.kind === 'tests') {
    if (state.tests && state.tests.total > 0) {
      const { passed, failed, skipped, total } = state.tests;
      const done = Math.min(total, passed + failed + skipped);
      return { detail: `${done} of ${total} · ${failed} failed`, progress: done / total };
    }
    if (state.collected && state.pytestPercent != null) {
      const done = Math.round((state.pytestPercent / 100) * state.collected);
      return { detail: `${done} of ${state.collected} · ${state.pytestFailed ?? 0} failed`, progress: state.pytestPercent / 100 };
    }
    if (state.files) return { detail: `${plural(state.files.done, 'file')} · ${state.files.failed} failed`, progress: null };
    return { detail: state.initial, progress: null };
  }
  return { detail: state.lastLine ?? state.initial, progress: null };
}

// Exit codes from being stopped (Ctrl-C, kill) rather than finishing.
const STOPPED_CODES = new Set([130, 137, 143]);

// How it ended, and what the Lock Screen says about it.
export function result(state: RunState, code: number | null): { status: Exclude<RunStatus, 'running'>; detail: string } {
  if (code == null || STOPPED_CODES.has(code)) return { status: 'stopped', detail: 'Stopped' };
  if (state.kind === 'server') return code === 0 ? { status: 'stopped', detail: 'Stopped' } : { status: 'failed', detail: `Exited with code ${code}` };
  if (state.kind === 'tests') {
    const t = state.tests;
    const failed = code !== 0 || (t?.failed ?? 0) > 0;
    if (t && t.total > 0) {
      if (!failed) return { status: 'passed', detail: t.skipped ? `${t.passed} passed · ${t.skipped} skipped` : `All ${t.passed} passed` };
      if (t.failed > 0) return { status: 'failed', detail: `${t.failed} of ${t.total} failed` };
    }
    return failed ? { status: 'failed', detail: `Failed (exit code ${code})` } : { status: 'passed', detail: 'Passed' };
  }
  return code === 0 ? { status: 'passed', detail: 'Done' } : { status: 'failed', detail: `Exited with code ${code}` };
}

export interface RunActivityNative {
  start(args: { project: string; command: string; kind: RunKind; detail: string }): Promise<string | null>;
  update(id: string, args: { status: RunStatus; detail: string; progress: number | null }): Promise<void>;
  end(id: string, args: { status: Exclude<RunStatus, 'running'>; detail: string }): Promise<void>;
}

export interface RunActivityController {
  // A run started. Ends the one before it, if it's still going.
  onRunStart(project: string, command: string, kind: RunKind, detail?: string): void;
  // Output from the run, in any chunks (partial lines are kept until complete).
  onOutput(text: string): void;
  // It exited: 0 is success, null or 130/137/143 means it was stopped.
  onExit(code: number | null): void;
}

export const UPDATE_INTERVAL_MS = 2000;

export function createRunActivity(native: RunActivityNative, { enabled = () => true, interval = UPDATE_INTERVAL_MS }: { enabled?: () => boolean; interval?: number } = {}): RunActivityController {
  let run: { id: Promise<string | null>; state: RunState; partial: string; sent: RunView; sentAt: number; timer?: ReturnType<typeof setTimeout> } | null = null;

  const send = (r: NonNullable<typeof run>) => {
    r.timer = undefined;
    const next = view(r.state);
    if (next.detail === r.sent.detail && next.progress === r.sent.progress) return;
    r.sent = next;
    r.sentAt = Date.now();
    r.id.then((id) => (id ? native.update(id, { status: 'running', ...next }) : undefined)).catch(() => undefined);
  };

  // At most one update per interval; the latest wins.
  const schedule = (r: NonNullable<typeof run>) => {
    if (r.timer) return;
    const wait = r.sentAt + interval - Date.now();
    if (wait <= 0) send(r);
    else r.timer = setTimeout(() => run === r && send(r), wait);
  };

  const finish = (code: number | null) => {
    const r = run;
    if (!r) return;
    run = null;
    if (r.timer) clearTimeout(r.timer);
    if (r.partial) r.state = readLine(r.state, r.partial);
    const end = result(r.state, code);
    r.id.then((id) => (id ? native.end(id, end) : undefined)).catch(() => undefined);
  };

  return {
    onRunStart(project, command, kind, detail) {
      finish(null);
      if (!enabled()) return;
      const state = initialState(kind, command, detail);
      const sent = view(state);
      run = { id: native.start({ project, command, kind, detail: sent.detail }).catch(() => null), state, partial: '', sent, sentAt: Date.now() };
    },
    onOutput(text) {
      const r = run;
      if (!r) return;
      const lines = (r.partial + text).split('\n');
      // Keep an unfinished last line, but not forever.
      r.partial = lines.pop()!.slice(-2000);
      for (const line of lines) r.state = readLine(r.state, line);
      schedule(r);
    },
    onExit(code) {
      finish(code);
    },
  };
}
