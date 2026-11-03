import { requireOptionalNativeModule } from 'expo';

export type RunKind = 'server' | 'tests' | 'task';
export type RunStatus = 'running' | 'passed' | 'failed' | 'stopped';

// Absent on web, Android and in tests; callers treat that as "no widgets".
interface TideWidgetsModule {
  setSharedData(json: string): void;
  activitiesEnabled(): boolean;
  startDeployActivity(project: string, provider: string, message: string): Promise<string | null>;
  updateDeployActivity(id: string, state: 'deploying' | 'done' | 'failed', message: string, url: string | null): Promise<void>;
  startRunActivity(project: string, command: string, kind: RunKind, detail: string): Promise<string | null>;
  updateRunActivity(id: string, status: RunStatus, detail: string, progress: number | null): Promise<void>;
  endRunActivity(id: string, status: RunStatus, detail: string): Promise<void>;
}

const native = requireOptionalNativeModule<TideWidgetsModule>('TideWidgets');
export default native;

// The run Live Activity (dev servers, tests, tasks). Each is a no-op where
// there's no native module or Live Activities are off; start resolves to null
// then, and never rejects.
export async function startRunActivity({ project, command, kind, detail }: { project: string; command: string; kind: RunKind; detail: string }): Promise<string | null> {
  if (!native) return null;
  try {
    if (!native.activitiesEnabled()) return null;
    return await native.startRunActivity(project, command, kind, detail);
  } catch {
    return null;
  }
}

export async function updateRunActivity(id: string, { status, detail, progress }: { status: RunStatus; detail: string; progress?: number | null }): Promise<void> {
  if (!native) return;
  const p = progress == null ? null : Math.min(1, Math.max(0, progress));
  await native.updateRunActivity(id, status, detail, p).catch(() => undefined);
}

export async function endRunActivity(id: string, { status, detail }: { status: Exclude<RunStatus, 'running'>; detail: string }): Promise<void> {
  if (!native) return;
  await native.endRunActivity(id, status, detail).catch(() => undefined);
}
