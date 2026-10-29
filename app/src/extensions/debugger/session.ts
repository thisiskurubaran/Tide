import type { DebugCommand, DebugFrame, DebugVariable, Runtime } from '@shared/protocol';
import { createStore, StoreApi } from 'zustand';

import { joinPath } from '../../features/files/fs';
import { PROJECTS_DIR } from '../../features/files/workspace';
import type { Runner } from '../../runtime/runner';
import type { BreakpointsState } from './breakpoints';

export type DebugStatus = 'idle' | 'starting' | 'running' | 'paused' | 'ended';

export interface ConsoleLine {
  kind: 'stdout' | 'stderr' | 'input' | 'result' | 'error' | 'info';
  text: string;
}

export interface DebugState {
  status: DebugStatus;
  project: string | null;
  // The file being debugged, relative to the project.
  entry: string | null;
  frames: DebugFrame[];
  // Index into frames of the frame whose variables are shown.
  frame: number;
  // Children by variable or scope ref, for the current pause.
  variables: Record<number, DebugVariable[]>;
  console: ConsoleLine[];
  exitCode: number | null;
  start(project: string, entry: string): void;
  command(command: Extract<DebugCommand, { cmd: 'continue' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut' }>['cmd']): void;
  loadVariables(ref: number): void;
  evaluate(expression: string): void;
  input(text: string): void;
  selectFrame(index: number): void;
  stop(): void;
  close(): void;
}

export const runtimeFor = (path: string): Runtime | null => (/\.py$/i.test(path) ? 'python' : /\.(c|m)?js$/i.test(path) ? 'node' : null);

// The first frame in one of the project's files: where the editor shows the pause.
export function projectFrame(frames: DebugFrame[], project: string): { index: number; path: string; line: number } | null {
  const prefix = `${PROJECTS_DIR}/${project}/`;
  const index = frames.findIndex((f) => f.file?.startsWith(prefix));
  if (index === -1) return null;
  return { index, path: frames[index].file!.slice(prefix.length), line: frames[index].line };
}

const MAX_CONSOLE = 2000;
let runs = 0;

export function createDebugStore(runner: Runner, breakpoints: StoreApi<BreakpointsState>, env: () => Record<string, string> = () => ({})) {
  let unsubscribe: (() => void) | null = null;
  let req = 0;
  const pending = new Map<number, (v: DebugVariable[] | { result?: DebugVariable; error?: string }) => void>();

  const store = createStore<DebugState>()((set, get) => {
    const log = (kind: ConsoleLine['kind'], text: string) =>
      set((s) => {
        const console = [...s.console];
        // Program output arrives in chunks; join it into lines.
        const last = console[console.length - 1];
        if ((kind === 'stdout' || kind === 'stderr') && last?.kind === kind && !last.text.endsWith('\n')) console[console.length - 1] = { kind, text: last.text + text };
        else console.push({ kind, text });
        return { console: console.slice(-MAX_CONSOLE) };
      });

    const send = (command: DebugCommand) => {
      const id = runId;
      if (id) runner.send({ type: 'debug', id, command });
    };
    let runId: string | null = null;

    const finish = () => {
      unsubscribe?.();
      unsubscribe = null;
      runId = null;
      pending.clear();
      breakpoints.getState().setPaused(null);
    };

    return {
      status: 'idle',
      project: null,
      entry: null,
      frames: [],
      frame: 0,
      variables: {},
      console: [],
      exitCode: null,
      start(project, entry) {
        const runtime = runtimeFor(entry);
        if (!runtime) throw new Error(`Only JavaScript and Python files can be debugged, not ${entry}`);
        if (runId) get().stop();
        const id = `debug-${++runs}`;
        runId = id;
        const root = (path: string) => joinPath(PROJECTS_DIR, project, path);
        const files = breakpoints.getState().byProject[project] ?? {};
        set({ status: 'starting', project, entry, frames: [], frame: 0, variables: {}, console: [{ kind: 'info', text: `Debugging ${entry}` }], exitCode: null });

        // Breakpoints set or moved during the session go to the running program.
        let last = files;
        unsubscribe = breakpoints.subscribe((s) => {
          const now = s.byProject[project] ?? {};
          if (now === last) return;
          for (const path of new Set([...Object.keys(now), ...Object.keys(last)])) {
            if (now[path] !== last[path]) send({ cmd: 'setBreakpoints', file: root(path), lines: now[path] ?? [] });
          }
          last = now;
        });

        runner.run(
          {
            type: 'run',
            id,
            runtime,
            entry: root(entry),
            cwd: joinPath(PROJECTS_DIR, project),
            args: [],
            env: env(),
            debug: { breakpoints: Object.fromEntries(Object.entries(files).map(([p, lines]) => [root(p), lines])) },
          },
          (msg) => {
            if (runId !== id) return;
            if (msg.type === 'stdout' || msg.type === 'stderr') {
              if (get().status === 'starting') set({ status: 'running' });
              log(msg.type, msg.data);
            } else if (msg.type === 'exit') {
              finish();
              set({ status: 'ended', exitCode: msg.code, frames: [], variables: {} });
              log('info', msg.signal ? 'Stopped.' : `Exited with code ${msg.code}.`);
            } else if (msg.type === 'debug') {
              const e = msg.event;
              if (e.event === 'stopped') {
                const at = projectFrame(e.frames, project);
                set({ status: 'paused', frames: e.frames, frame: at?.index ?? 0, variables: {} });
                breakpoints.getState().setPaused(at ? { project, path: at.path, line: at.line } : null);
                // Locals of the shown frame load straight away.
                const scope = e.frames[at?.index ?? 0]?.scopes[0];
                if (scope) get().loadVariables(scope.ref);
              } else if (e.event === 'resumed') {
                set({ status: 'running', frames: [], variables: {} });
                breakpoints.getState().setPaused(null);
              } else if (e.event === 'variables') {
                pending.get(e.req)?.(e.variables);
                pending.delete(e.req);
              } else if (e.event === 'evaluated') {
                pending.get(e.req)?.(e);
                pending.delete(e.req);
              }
            }
          },
        );
      },
      command(cmd) {
        send({ cmd } as DebugCommand);
      },
      loadVariables(ref) {
        const r = ++req;
        pending.set(r, (vars) => set((s) => ({ variables: { ...s.variables, [ref]: vars as DebugVariable[] } })));
        send({ cmd: 'variables', ref, req: r });
      },
      evaluate(expression) {
        const r = ++req;
        log('input', expression);
        pending.set(r, (result) => {
          const { result: value, error } = result as { result?: DebugVariable; error?: string };
          if (error !== undefined) log('error', error);
          else if (value) log('result', value.value);
        });
        send({ cmd: 'evaluate', expression, frame: get().frame, req: r });
      },
      input(text) {
        if (!runId) return;
        log('input', text);
        runner.send({ type: 'stdin', id: runId, data: `${text}\n` });
      },
      selectFrame(index) {
        const f = get().frames[index];
        if (!f) return;
        set({ frame: index });
        if (f.scopes[0] && !get().variables[f.scopes[0].ref]) get().loadVariables(f.scopes[0].ref);
      },
      stop() {
        if (runId) runner.send({ type: 'kill', id: runId });
      },
      close() {
        get().stop();
        finish();
        set({ status: 'idle', project: null, entry: null, frames: [], variables: {}, console: [], exitCode: null });
      },
    };
  });
  return store;
}
