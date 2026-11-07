// The agent as the app runs it: one conversation per project, kept in memory
// for the session, wired to the real workspace, editors, terminal and AI
// client. The loop itself (agent.ts) and the tools (tools.ts) know none of this.
import { createStore, useStore } from 'zustand';

import { agentStep, AiError } from '../ai/client';
import type { AgentMessage, Usage } from '../ai/client';
import { autoDeployer } from '../deploy';
import { openProjectDb } from '../database/open';
import { projectEnv, readSecrets } from '../env/store';
import { PROJECTS_DIR } from '../files/workspace';
import { gitEnv } from '../git/settings';
import { Shell } from '../terminal/shell/shell';
import { createShellFs } from '../terminal/shell/shellFs';
import { localRunner } from '../../runtime';
import { buffersStore, projectsStore, workspace } from '../../state';
import { ApprovalRequest, buildSystemPrompt, Decision, runAgent, StepStatus } from './agent';
import { commandApprovals } from './approvalsStore';
import { changesStore, readCurrent } from './changesStore';
import { createShellCommandRunner } from './shellRunner';
import { AGENT_TOOLS, AgentFiles, CommandRunner, StepView, TestRun } from './tools';

// ---------------------------------------------------------------------------
// Files: pending changes and what the user has live in changesStore.ts, so the
// app can load saved changes at start-up without loading the whole agent.

export { changesStore, useChanges } from './changesStore';

function commandRunner(project: string): CommandRunner {
  const runner = createShellCommandRunner(
    (hooks) =>
      new Shell({
        project,
        fs: createShellFs(project, workspace, projectsStore, buffersStore),
        runner: localRunner,
        write: hooks.write,
        projectRoot: `${PROJECTS_DIR}/${project}`,
        toolEnv: gitEnv,
        sqlite: { open: (path) => openProjectDb(project, path) },
        projectEnv: async () => {
          const [values, secrets] = await Promise.all([projectEnv(project), readSecrets(project)]);
          return { values, secrets: Object.keys(secrets) };
        },
        onBusy: hooks.onBusy,
        onRunExit: (entry, args, code) => {
          hooks.onRunExit(entry, args, code);
          if (entry === 'tide:git' && args[0] === 'commit' && code === 0) autoDeployer.onCommit(project).catch(() => undefined);
        },
      }),
  );
  return {
    async run(command, options) {
      // Programs read the disk: unsaved editor text goes there first.
      await buffersStore.getState().flushProject(project);
      try {
        return await runner.run(command, options);
      } finally {
        // Programs write files directly; editors that aren't mid-edit pick that up.
        await buffersStore.getState().reloadProject(project);
        await projectsStore.getState().loadTree(project).catch(() => undefined);
      }
    },
  };
}

const filesOf = (project: string): AgentFiles => ({
  listFiles: () => workspace.listFiles(project),
  read: (path) => readCurrent(project, path),
});

// ---------------------------------------------------------------------------
// "Always for npm", per project, kept across launches (approvals.ts)

export const isAlwaysAllowed = (project: string, key: string) => commandApprovals.isAllowed(project, key);
export const setAlwaysAllowed = (project: string, key: string, allowed: boolean) => commandApprovals.setAllowed(project, key, allowed);

// ---------------------------------------------------------------------------
// The chat as the screen shows it

export interface StepRow {
  id: string;
  view: StepView;
  status: StepStatus;
  detail?: string;
}

export type TurnItem = { kind: 'text'; text: string } | { kind: 'step'; step: StepRow };

export interface Turn {
  id: string;
  prompt: string;
  items: TurnItem[];
  status: 'running' | 'done' | 'stopped' | 'error';
  // The summary, or why it stopped.
  message?: string;
  errorKind?: AiError['kind'];
  startedAt: number;
  endedAt?: number;
  usage: Usage;
}

export interface AgentSession {
  turns: Turn[];
  history: AgentMessage[];
  running: boolean;
  approval: ApprovalRequest | null;
  // The last test command the agent ran, for the review screen.
  lastTest: TestRun | null;
  usage: Usage;
  // Composer text, e.g. "Ask for changes" from the review screen.
  draft: string;
}

const emptySession = (): AgentSession => ({ turns: [], history: [], running: false, approval: null, lastTest: null, usage: { inputTokens: 0, outputTokens: 0 }, draft: '' });

interface SessionsState {
  sessions: Record<string, AgentSession>;
}

export const sessionsStore = createStore<SessionsState>()(() => ({ sessions: {} }));
const EMPTY = emptySession();
export const useAgentSession = (project: string) => useStore(sessionsStore, (s) => s.sessions[project] ?? EMPTY);

const getSession = (project: string) => sessionsStore.getState().sessions[project] ?? emptySession();
const patch = (project: string, fn: (s: AgentSession) => Partial<AgentSession>) =>
  sessionsStore.setState((st) => {
    const current = st.sessions[project] ?? emptySession();
    return { sessions: { ...st.sessions, [project]: { ...current, ...fn(current) } } };
  });
const patchTurn = (project: string, id: string, fn: (t: Turn) => Partial<Turn>) =>
  patch(project, (s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) }));

const controllers = new Map<string, AbortController>();
const approvals = new Map<string, (d: Decision) => void>();
let turnCounter = 0;

export function setDraft(project: string, draft: string) {
  patch(project, () => ({ draft }));
}

export function stopAgent(project: string) {
  controllers.get(project)?.abort();
}

export function answerApproval(project: string, decision: Decision) {
  const approval = getSession(project).approval;
  const resolve = approvals.get(project);
  if (!approval || !resolve) return;
  approvals.delete(project);
  patch(project, () => ({ approval: null }));
  if (decision === 'always') setAlwaysAllowed(project, approval.key, true).catch(() => undefined);
  resolve(decision);
}

export function clearConversation(project: string) {
  if (getSession(project).running) return;
  patch(project, () => ({ ...emptySession() }));
}

async function readScripts(project: string): Promise<Record<string, string> | undefined> {
  const text = await readCurrent(project, 'package.json').catch(() => null);
  if (!text) return undefined;
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    return scripts && typeof scripts === 'object' ? (scripts as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}

export async function sendToAgent(project: string, prompt: string) {
  const text = prompt.trim();
  if (!text || getSession(project).running) return;
  const id = `turn-${Date.now()}-${++turnCounter}`;
  const controller = new AbortController();
  controllers.set(project, controller);
  const turn: Turn = { id, prompt: text, items: [], status: 'running', startedAt: Date.now(), usage: { inputTokens: 0, outputTokens: 0 } };
  // A turn that ended without a reply (Stop, an error) leaves a user message
  // last; the new one joins it so roles keep alternating.
  const prior = getSession(project).history;
  const last = prior[prior.length - 1];
  const history: AgentMessage[] = last?.role === 'user' ? [...prior.slice(0, -1), { role: 'user', text: `${last.text}\n\n${text}` }] : [...prior, { role: 'user', text }];
  patch(project, (s) => ({ turns: [...s.turns, turn], running: true, draft: '', history }));

  const addText = (delta: string) =>
    patchTurn(project, id, (t) => {
      const items = [...t.items];
      const tail = items[items.length - 1];
      if (tail?.kind === 'text') items[items.length - 1] = { kind: 'text', text: tail.text + delta };
      else items.push({ kind: 'text', text: delta });
      return { items };
    });
  const setStep = (row: StepRow) =>
    patchTurn(project, id, (t) => {
      const at = t.items.findIndex((i) => i.kind === 'step' && i.step.id === row.id);
      const items = [...t.items];
      if (at >= 0) items[at] = { kind: 'step', step: row };
      else items.push({ kind: 'step', step: row });
      return { items };
    });

  try {
    await buffersStore.getState().flushProject(project).catch(() => undefined);
    const [files, scripts] = await Promise.all([workspace.listFiles(project).catch(() => [] as string[]), readScripts(project)]);
    const result = await runAgent({
      step: agentStep,
      tools: AGENT_TOOLS,
      env: { project, files: filesOf(project), changes: changesStore, commands: commandRunner(project) },
      system: buildSystemPrompt({ project, files, scripts }),
      history,
      signal: controller.signal,
      async confirm(req) {
        if (await isAlwaysAllowed(project, req.key)) return 'once';
        return new Promise<Decision>((resolve) => {
          approvals.set(project, resolve);
          patch(project, () => ({ approval: req }));
          controller.signal.addEventListener('abort', () => {
            if (approvals.get(project) === resolve) approvals.delete(project);
            patch(project, () => ({ approval: null }));
          });
        });
      },
      onEvent(e) {
        if (e.type === 'text') addText(e.delta);
        else if (e.type === 'step') setStep({ id: e.id, view: e.view, status: e.status, detail: e.detail });
        else if (e.type === 'usage') {
          patchTurn(project, id, () => ({ usage: e.total }));
          patch(project, (s) => ({ usage: { inputTokens: s.usage.inputTokens + e.step.inputTokens, outputTokens: s.usage.outputTokens + e.step.outputTokens } }));
        }
      },
    });
    const status: Turn['status'] = result.reason === 'aborted' ? 'stopped' : result.reason === 'error' ? 'error' : 'done';
    const errorKind = result.error instanceof AiError ? result.error.kind : undefined;
    patchTurn(project, id, () => ({ status, message: result.message, errorKind, endedAt: Date.now() }));
    patch(project, (s) => ({ history: result.history, lastTest: result.tests[result.tests.length - 1] ?? s.lastTest }));
  } catch (e) {
    patchTurn(project, id, () => ({ status: 'error', message: e instanceof Error ? e.message : String(e), errorKind: e instanceof AiError ? e.kind : undefined, endedAt: Date.now() }));
  } finally {
    controllers.delete(project);
    approvals.delete(project);
    patch(project, () => ({ running: false, approval: null }));
  }
}
