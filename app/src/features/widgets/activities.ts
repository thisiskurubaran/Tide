// The git, package install and AI agent Live Activities: what each shows,
// read from output or state, and when it starts, changes or ends. Pure apart
// from the injected native calls and timers, so it's testable without the
// module. A start that resolves to null (no module, Live Activities off) makes
// the rest no-ops.
import type { AgentResult, AgentStatus, GitOperation, InstallTool, TaskResult } from '../../../modules/tide-widgets/src';
import { stripAnsi } from './runOutput';

// ---------------------------------------------------------------------------
// Throttling: ActivityKit budgets updates, and git redraws its progress many
// times a second. At most one update per interval goes out; the latest wins,
// and one equal to the last sent is dropped.

export interface Throttled<U, E> {
  // `immediate` skips the wait, e.g. for something the user has to act on.
  update(next: U, immediate?: boolean): void;
  // Ends it with `result`, dropping a pending update. Later calls do nothing.
  end(result: E): void;
}

export function throttled<U, E>(
  id: Promise<string | null>,
  send: (id: string, next: U) => Promise<void>,
  finish: (id: string, result: E) => Promise<void>,
  interval: number,
): Throttled<U, E> {
  let sentKey = '';
  let sentAt = 0;
  let latest: U | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;

  const flush = () => {
    timer = undefined;
    if (ended || latest == null) return;
    const next = latest;
    latest = null;
    const key = JSON.stringify(next);
    if (key === sentKey) return;
    sentKey = key;
    sentAt = Date.now();
    id.then((i) => (i ? send(i, next) : undefined)).catch(() => undefined);
  };

  return {
    update(next, immediate = false) {
      if (ended) return;
      latest = next;
      if (immediate && timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (timer) return;
      if (immediate) return flush();
      const wait = sentAt + interval - Date.now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    end(result) {
      if (ended) return;
      ended = true;
      if (timer) clearTimeout(timer);
      id.then((i) => (i ? finish(i, result) : undefined)).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// git clone / pull / push

export interface GitProgress {
  // "Receiving objects", "Resolving deltas", "Writing objects"...
  phase: string;
  // "45/120", or "" when git doesn't say how many.
  detail: string;
  progress: number | null;
}

// The last progress line in git's output so far. The built-in git redraws
// "\r\x1b[KReceiving objects: 45% (54/120)" in place; real git prints the
// same with ", done." at the end of each phase.
export function gitProgress(text: string): GitProgress | null {
  const parts = stripAnsi(text).split(/[\r\n]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const line = parts[i].replace(/^remote:\s*/, '').trim();
    let m = line.match(/^([A-Za-z][A-Za-z ]+?):\s+(\d{1,3})%\s*(?:\((\d+\/\d+)\))?/);
    if (m) return { phase: m[1], detail: m[3] ?? '', progress: Math.min(100, Number(m[2])) / 100 };
    m = line.match(/^([A-Za-z][A-Za-z ]+?):\s+(\d+)\s*$/);
    if (m) return { phase: m[1], detail: m[2], progress: null };
  }
  return null;
}

const GIT_TITLES: Record<GitOperation, { start: string; done: string; failed: string }> = {
  clone: { start: 'Connecting…', done: 'Cloned', failed: 'Clone failed' },
  pull: { start: 'Fetching…', done: 'Pulled', failed: 'Pull failed' },
  push: { start: 'Connecting…', done: 'Pushed', failed: 'Push failed' },
};

// The host and repository of a remote URL, for the subtitle: "github.com/a/b".
export function remoteLabel(url: string): string {
  const t = url.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const ssh = t.match(/^[\w.-]+@([\w.-]+):(.+)$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  try {
    const u = new URL(t);
    return `${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return t;
  }
}

// What the end of an operation says: the last line git printed that isn't a
// progress redraw ("Already up to date.", "main -> main"), or the error.
export function gitResultDetail(operation: GitOperation, ok: boolean, output: string, error?: string): string {
  if (!ok && error) return error.replace(/^fatal: /, '').split('\n')[0].slice(0, 120);
  const lines = stripAnsi(output)
    .split('\n')
    .map((l) => l.slice(l.lastIndexOf('\r') + 1).trim())
    .filter((l) => l && !gitProgress(l));
  const last = lines[lines.length - 1]?.replace(/^fatal: /, '').slice(0, 120);
  if (!ok) return last || GIT_TITLES[operation].failed;
  if (operation === 'pull' && last && /up to date|fast-forward|files? changed|merge/i.test(last)) return last;
  return GIT_TITLES[operation].done;
}

export interface GitActivityNative {
  start(args: { project: string; operation: GitOperation; remote: string; detail: string }): Promise<string | null>;
  update(id: string, args: GitProgress): Promise<void>;
  end(id: string, args: { status: TaskResult; detail: string }): Promise<void>;
}

export interface GitActivityRun {
  // Output in any chunks; progress is read from what's printed so far.
  output(text: string): void;
  // `error` is the message the caller shows for a failure.
  end(ok: boolean, error?: string): void;
}

export const GIT_INTERVAL_MS = 1000;

export function createGitActivity(native: GitActivityNative, { enabled = () => true, interval = GIT_INTERVAL_MS }: { enabled?: () => boolean; interval?: number } = {}) {
  return {
    begin(project: string, operation: GitOperation, remote = ''): GitActivityRun {
      const id = enabled() ? native.start({ project, operation, remote: remoteLabel(remote), detail: GIT_TITLES[operation].start }).catch(() => null) : Promise.resolve(null);
      const live = throttled<GitProgress, { status: TaskResult; detail: string }>(id, native.update, native.end, interval);
      // Only the tail matters for progress; the whole output for the result.
      let text = '';
      return {
        output(chunk) {
          text = (text + chunk).slice(-8000);
          const p = gitProgress(text);
          if (p) live.update(p);
        },
        end(ok, error) {
          live.end({ status: ok ? 'done' : 'failed', detail: gitResultDetail(operation, ok, text, error) });
        },
      };
    },
  };
}

// Runs `work` with a git activity, ending it however `work` ends: a result
// of `{ code }` other than 0 or a throw is a failure.
export async function withGitActivity<T>(
  activity: ReturnType<typeof createGitActivity>,
  { project, operation, remote }: { project: string; operation: GitOperation; remote?: string },
  work: (onOutput: (text: string) => void) => Promise<T>,
): Promise<T> {
  // The activity is extra: if it can't start, the work still runs.
  let run: GitActivityRun;
  try {
    run = activity.begin(project, operation, remote);
  } catch {
    run = { output: () => undefined, end: () => undefined };
  }
  try {
    const result = await work((t) => run.output(t));
    const code = (result as { code?: unknown } | null)?.code;
    const failed = typeof code === 'number' && code !== 0;
    const stderr = (result as { stderr?: unknown } | null)?.stderr;
    run.end(!failed, failed && typeof stderr === 'string' ? lastMeaningfulLine(stderr) : undefined);
    return result;
  } catch (e) {
    run.end(false, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

const lastMeaningfulLine = (text: string) =>
  stripAnsi(text)
    .split('\n')
    .map((l) => l.slice(l.lastIndexOf('\r') + 1).trim())
    .filter(Boolean)
    .pop() ?? '';

// ---------------------------------------------------------------------------
// npm / pip installs

export interface InstallActivityNative {
  start(args: { project: string; tool: InstallTool; packages: string }): Promise<string | null>;
  update(id: string, args: { detail: string }): Promise<void>;
  end(id: string, args: { status: TaskResult; detail: string }): Promise<void>;
}

// The line worth showing from installer output: npm's "added 12 packages in
// 3s", pip's "Collecting requests" / "Successfully installed...".
export function installDetail(line: string): string | null {
  const l = stripAnsi(line).replace(/\r/g, '').trim();
  if (!l || /^npm (warn|notice)/i.test(l) || /^[-\\|/]$/.test(l)) return null;
  return l.replace(/^npm (http fetch|info)\s+/i, '').slice(0, 90);
}

export function installResult(tool: InstallTool, code: number, lastLine: string | null): { status: TaskResult; detail: string } {
  if (code === 0) return { status: 'done', detail: lastLine && /added|removed|changed|up to date|successfully/i.test(lastLine) ? lastLine : 'Done' };
  return { status: 'failed', detail: lastLine && /err|fail|not found|could not/i.test(lastLine) ? lastLine : `${tool} exited with code ${code}` };
}

export const INSTALL_INTERVAL_MS = 1500;

export function createInstallActivity(native: InstallActivityNative, { enabled = () => true, interval = INSTALL_INTERVAL_MS }: { enabled?: () => boolean; interval?: number } = {}) {
  return {
    begin(project: string, tool: InstallTool, packages: string) {
      const id = enabled() ? native.start({ project, tool, packages }).catch(() => null) : Promise.resolve(null);
      const live = throttled<{ detail: string }, { status: TaskResult; detail: string }>(id, native.update, native.end, interval);
      let partial = '';
      let last: string | null = null;
      return {
        output(chunk: string) {
          const lines = (partial + chunk).split('\n');
          partial = lines.pop()!.slice(-2000);
          for (const line of lines) {
            const d = installDetail(line);
            if (d) last = d;
          }
          if (last) live.update({ detail: last });
        },
        end(code: number) {
          const d = partial ? installDetail(partial) : null;
          live.end(installResult(tool, code, d ?? last));
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The AI agent

// The parts of an agent session (agent/session.ts) the activity reads.
export interface AgentSnapshot {
  running: boolean;
  approval: { command: string } | null;
  turns: {
    prompt: string;
    status: 'running' | 'done' | 'stopped' | 'error';
    message?: string;
    items: ({ kind: 'text' } | { kind: 'step'; step: { view: { verb: string; chips: string[] }; status: string } })[];
  }[];
}

const VERB_RUNNING: Record<string, string> = {
  Listed: 'Listing',
  Read: 'Reading',
  Searched: 'Searching',
  Edited: 'Editing',
  Created: 'Creating',
  Ran: 'Running',
  Finished: 'Finishing',
  Used: 'Using',
};

export interface AgentView {
  status: AgentStatus;
  steps: number;
  action: string;
  command: string | null;
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// What the activity shows for the latest turn: the step count, what it's
// doing now, and the command waiting for approval.
export function agentView(session: AgentSnapshot): AgentView {
  const turn = session.turns[session.turns.length - 1];
  const steps = turn ? turn.items.filter((i) => i.kind === 'step') : [];
  const last = steps[steps.length - 1] as Extract<AgentSnapshot['turns'][number]['items'][number], { kind: 'step' }> | undefined;
  if (session.approval) {
    return { status: 'approval', steps: steps.length, action: 'Waiting for your approval', command: short(session.approval.command, 80) };
  }
  let action = 'Thinking…';
  if (last && (last.step.status === 'running' || last.step.status === 'waiting')) {
    const chip = last.step.view.chips[0];
    action = `${VERB_RUNNING[last.step.view.verb] ?? last.step.view.verb}${chip ? ` ${chip}` : ''}`;
  }
  return { status: 'working', steps: steps.length, action: short(action, 80), command: null };
}

export function agentResult(session: AgentSnapshot): { status: AgentResult; steps: number; action: string } {
  const turn = session.turns[session.turns.length - 1];
  const steps = turn ? turn.items.filter((i) => i.kind === 'step').length : 0;
  if (!turn || turn.status === 'stopped') return { status: 'stopped', steps, action: 'Stopped' };
  if (turn.status === 'error') return { status: 'failed', steps, action: short(turn.message || 'The agent stopped with an error', 80) };
  return { status: 'done', steps, action: short(turn.message?.split('\n')[0] || 'Done, ready for review', 80) };
}

export interface AgentActivityNative {
  start(args: { project: string; prompt: string }): Promise<string | null>;
  update(id: string, args: AgentView): Promise<void>;
  end(id: string, args: { status: AgentResult; steps: number; action: string }): Promise<void>;
}

export const AGENT_INTERVAL_MS = 1500;

// Follows each project's session: starts when a turn starts running, updates
// as steps come in (an approval request goes out straight away), and ends
// with the turn.
export function createAgentActivity(native: AgentActivityNative, { enabled = () => true, interval = AGENT_INTERVAL_MS }: { enabled?: () => boolean; interval?: number } = {}) {
  const live = new Map<string, Throttled<AgentView, { status: AgentResult; steps: number; action: string }>>();
  return {
    onSession(project: string, session: AgentSnapshot | undefined) {
      const current = live.get(project);
      if (session?.running) {
        let a = current;
        if (!a) {
          if (!enabled()) return;
          const turn = session.turns[session.turns.length - 1];
          const id = native.start({ project, prompt: short(turn?.prompt ?? '', 120) }).catch(() => null);
          a = throttled(id, native.update, native.end, interval);
          live.set(project, a);
        }
        const v = agentView(session);
        // Approval requests skip the wait: the user is the one holding it up.
        a.update(v, v.status === 'approval');
      } else if (current) {
        live.delete(project);
        current.end(session ? agentResult(session) : { status: 'stopped', steps: 0, action: 'Stopped' });
      }
    },
  };
}
