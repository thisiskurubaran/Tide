import { requireOptionalNativeModule } from 'expo';

export type RunKind = 'server' | 'tests' | 'task';
export type RunStatus = 'running' | 'passed' | 'failed' | 'stopped';
export type GitOperation = 'clone' | 'pull' | 'push';
// How a git operation or a package install ended.
export type TaskResult = 'done' | 'failed';
// "working" while it thinks and uses tools, "approval" while a command waits
// for the user.
export type AgentStatus = 'working' | 'approval';
export type AgentResult = 'done' | 'failed' | 'stopped';
export type InstallTool = 'npm' | 'pip';

// Absent on web, Android and in tests; callers treat that as "no widgets".
// Functions added after the first release are optional, so a dev client built
// before them still loads.
interface TideWidgetsModule {
  setSharedData(json: string): void;
  activitiesEnabled(): boolean;
  startDeployActivity(project: string, provider: string, message: string): Promise<string | null>;
  updateDeployActivity(id: string, state: 'deploying' | 'done' | 'failed', message: string, url: string | null): Promise<void>;
  startRunActivity(project: string, command: string, kind: RunKind, detail: string): Promise<string | null>;
  updateRunActivity(id: string, status: RunStatus, detail: string, progress: number | null): Promise<void>;
  endRunActivity(id: string, status: RunStatus, detail: string): Promise<void>;

  startGitActivity?(project: string, operation: GitOperation, remote: string, detail: string): Promise<string | null>;
  updateGitActivity?(id: string, phase: string, detail: string, progress: number | null): Promise<void>;
  endGitActivity?(id: string, status: TaskResult, detail: string): Promise<void>;

  startAgentActivity?(project: string, prompt: string): Promise<string | null>;
  updateAgentActivity?(id: string, status: AgentStatus, steps: number, action: string, command: string | null): Promise<void>;
  endAgentActivity?(id: string, status: AgentResult, steps: number, action: string): Promise<void>;

  startInstallActivity?(project: string, tool: InstallTool, packages: string): Promise<string | null>;
  updateInstallActivity?(id: string, detail: string): Promise<void>;
  endInstallActivity?(id: string, status: TaskResult, detail: string): Promise<void>;

  // Ends activities a previous launch left behind (the app was killed).
  endStaleActivities?(): Promise<void>;

  // Spotlight: replaces the indexed projects with these ({name, language?,
  // openedAt?}[] as JSON), and removes deleted ones.
  indexProjects?(json: string): Promise<void>;
  removeIndexedProjects?(names: string[]): Promise<void>;
  // A tide:// link from a Spotlight result that launched the app before JS
  // was listening; null when there's none. Later results open directly.
  takePendingLink?(): string | null;
}

const native = requireOptionalNativeModule<TideWidgetsModule>('TideWidgets');
export default native;

const clamp01 = (p: number | null | undefined) => (p == null || !Number.isFinite(p) ? null : Math.min(1, Math.max(0, p)));

// Starts an activity when there's a module, the function exists and Live
// Activities are on. Resolves to null otherwise, and never rejects.
async function start(fn: (() => Promise<string | null>) | null): Promise<string | null> {
  if (!native || !fn) return null;
  try {
    if (!native.activitiesEnabled()) return null;
    return await fn();
  } catch {
    return null;
  }
}

const quietly = async (p: Promise<void> | undefined) => {
  await p?.catch(() => undefined);
};

// The run Live Activity (dev servers, tests, tasks). Each is a no-op where
// there's no native module or Live Activities are off; start resolves to null
// then, and never rejects.
export async function startRunActivity({ project, command, kind, detail }: { project: string; command: string; kind: RunKind; detail: string }): Promise<string | null> {
  return start(native ? () => native.startRunActivity(project, command, kind, detail) : null);
}

export async function updateRunActivity(id: string, { status, detail, progress }: { status: RunStatus; detail: string; progress?: number | null }): Promise<void> {
  if (!native) return;
  await quietly(native.updateRunActivity(id, status, detail, clamp01(progress)));
}

export async function endRunActivity(id: string, { status, detail }: { status: Exclude<RunStatus, 'running'>; detail: string }): Promise<void> {
  if (!native) return;
  await quietly(native.endRunActivity(id, status, detail));
}

// git clone, pull and push.
export async function startGitActivity({ project, operation, remote, detail }: { project: string; operation: GitOperation; remote: string; detail: string }): Promise<string | null> {
  return start(native?.startGitActivity ? () => native.startGitActivity!(project, operation, remote, detail) : null);
}

export async function updateGitActivity(id: string, { phase, detail, progress }: { phase: string; detail: string; progress: number | null }): Promise<void> {
  await quietly(native?.updateGitActivity?.(id, phase, detail, clamp01(progress)));
}

export async function endGitActivity(id: string, { status, detail }: { status: TaskResult; detail: string }): Promise<void> {
  await quietly(native?.endGitActivity?.(id, status, detail));
}

// The AI agent working on a project.
export async function startAgentActivity({ project, prompt }: { project: string; prompt: string }): Promise<string | null> {
  return start(native?.startAgentActivity ? () => native.startAgentActivity!(project, prompt) : null);
}

export async function updateAgentActivity(id: string, { status, steps, action, command }: { status: AgentStatus; steps: number; action: string; command: string | null }): Promise<void> {
  await quietly(native?.updateAgentActivity?.(id, status, steps, action, command));
}

export async function endAgentActivity(id: string, { status, steps, action }: { status: AgentResult; steps: number; action: string }): Promise<void> {
  await quietly(native?.endAgentActivity?.(id, status, steps, action));
}

// npm or pip installing, updating or removing packages.
export async function startInstallActivity({ project, tool, packages }: { project: string; tool: InstallTool; packages: string }): Promise<string | null> {
  return start(native?.startInstallActivity ? () => native.startInstallActivity!(project, tool, packages) : null);
}

export async function updateInstallActivity(id: string, { detail }: { detail: string }): Promise<void> {
  await quietly(native?.updateInstallActivity?.(id, detail));
}

export async function endInstallActivity(id: string, { status, detail }: { status: TaskResult; detail: string }): Promise<void> {
  await quietly(native?.endInstallActivity?.(id, status, detail));
}

export async function endStaleActivities(): Promise<void> {
  await quietly(native?.endStaleActivities?.());
}

// Spotlight (iOS). No-ops elsewhere.
export interface SpotlightProject {
  name: string;
  language?: string;
  // ms since the epoch
  openedAt?: number;
}

export async function indexProjects(projects: SpotlightProject[]): Promise<void> {
  await quietly(native?.indexProjects?.(JSON.stringify(projects)));
}

export async function removeIndexedProjects(names: string[]): Promise<void> {
  if (!names.length) return;
  await quietly(native?.removeIndexedProjects?.(names));
}

export function takePendingLink(): string | null {
  try {
    return native?.takePendingLink?.() ?? null;
  } catch {
    return null;
  }
}
